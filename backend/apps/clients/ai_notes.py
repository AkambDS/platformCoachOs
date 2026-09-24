"""CoachOS — AI-assisted drafting for session notes.

Turns a coach's raw session notes into three suggestions (tightened notes,
coach reflection, client commitment) that the coach can accept or reject
individually before saving. Nothing here touches the database — callers
persist whatever the coach ends up accepting through the normal note
create/update endpoints.
"""
import logging

from django.conf import settings

logger = logging.getLogger(__name__)

MODEL = "claude-haiku-4-5-20251001"
MAX_INPUT_CHARS = 6000

SUGGEST_TOOL = {
    "name": "note_suggestions",
    "description": "Structured drafting suggestions for a coaching session note.",
    "input_schema": {
        "type": "object",
        "properties": {
            "notes": {
                "type": "string",
                "description": "The session notes tightened for clarity — same facts and "
                                "meaning as the original, just clearer and better organized. "
                                "Do not invent details that weren't in the original notes.",
            },
            "reflection": {
                "type": "string",
                "description": "A short coach reflection (2-4 sentences): patterns, "
                                "progress, or concerns the coach might note about the client "
                                "based on this session.",
            },
            "commitment": {
                "type": "string",
                "description": "The concrete commitment(s) the client made during this "
                                "session, phrased as an action item. Empty string if the "
                                "notes don't mention one.",
            },
        },
        "required": ["notes", "reflection", "commitment"],
    },
}

SYSTEM_PROMPT = (
    "You help executive coaches turn rough session notes into clean, structured notes. "
    "Given a coach's raw notes from a client session, call the note_suggestions tool with "
    "three drafts: a clarity pass on the notes, a brief coach reflection, and the client's "
    "commitment. Stay grounded in what's actually in the notes — do not fabricate specifics "
    "the coach didn't write. If something isn't mentioned, leave that field empty rather than "
    "guessing."
)


class AISuggestionError(Exception):
    """Raised for any failure that should surface as a clean 4xx/502 to the client."""


def _mock_suggestions(raw_notes: str) -> dict:
    """Canned response used when AI_NOTES_MOCK=True — lets the accept/reject UI be
    exercised locally without an Anthropic account that has real credit on it. Never
    enable this setting outside local dev."""
    return {
        "notes":      f"[MOCK] {raw_notes.strip()}",
        "reflection": "[MOCK] Coach reflection: the client showed strong engagement this "
                       "session and is making steady progress toward their stated goals.",
        "commitment": "[MOCK] Client committed to following up on the discussed action "
                       "items before the next session.",
    }


def generate_session_suggestions(raw_notes: str) -> dict:
    """Return {"notes": str, "reflection": str, "commitment": str} drafted from raw_notes."""
    raw_notes = (raw_notes or "").strip()
    if not raw_notes:
        raise AISuggestionError("Write some session notes first, then ask for suggestions.")
    if len(raw_notes) > MAX_INPUT_CHARS:
        raise AISuggestionError(f"Session notes are too long for suggestions (max {MAX_INPUT_CHARS} characters).")

    if getattr(settings, "AI_NOTES_MOCK", False):
        return _mock_suggestions(raw_notes)

    if not settings.ANTHROPIC_API_KEY:
        raise AISuggestionError("AI suggestions aren't configured for this workspace yet.")

    import anthropic

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    try:
        response = client.messages.create(
            model=MODEL,
            max_tokens=1024,
            system=SYSTEM_PROMPT,
            tools=[SUGGEST_TOOL],
            tool_choice={"type": "tool", "name": "note_suggestions"},
            messages=[{"role": "user", "content": raw_notes}],
        )
    except anthropic.APIError as exc:
        logger.error(f"generate_session_suggestions: Anthropic API error: {exc}")
        raise AISuggestionError("AI suggestions are temporarily unavailable — please try again.") from exc

    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == "note_suggestions":
            data = block.input
            return {
                "notes":      (data.get("notes") or "").strip(),
                "reflection": (data.get("reflection") or "").strip(),
                "commitment": (data.get("commitment") or "").strip(),
            }

    logger.error(f"generate_session_suggestions: no tool_use block in response: {response}")
    raise AISuggestionError("AI suggestions are temporarily unavailable — please try again.")
