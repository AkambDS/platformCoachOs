"""CoachOS — feedback/views.py"""
from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.response import Response
from django.db.models import Count
from django.utils import timezone

from apps.accounts.permissions import IsWorkspaceMember, IsBusinessOwner
from .models import FeedbackTicket, FeedbackComment
from .serializers import (
    FeedbackListSerializer, FeedbackDetailSerializer,
    FeedbackCreateSerializer, FeedbackCommentSerializer,
)


class FeedbackViewSet(viewsets.ModelViewSet):
    """
    GET    /api/feedback/           — list tickets (owner: all; others: own)
    POST   /api/feedback/           — submit ticket (any workspace member)
    GET    /api/feedback/{id}/      — retrieve ticket detail
    PATCH  /api/feedback/{id}/      — update status/priority (owner only)
    POST   /api/feedback/{id}/comment/       — add comment (any workspace member)
    POST   /api/feedback/{id}/update-status/ — change status (owner only)
    POST   /api/feedback/{id}/close/         — close ticket (owner only)
    """
    permission_classes = [IsWorkspaceMember]
    pagination_class = None

    def get_queryset(self):
        user = self.request.user
        qs = FeedbackTicket.objects.filter(workspace=user.workspace).annotate(
            comment_count=Count("comments")
        ).select_related("submitted_by").order_by("-created_at")

        # Non-owners only see their own submissions in the list view
        if self.action == "list" and user.role != "business_owner":
            qs = qs.filter(submitted_by=user)

        # Filters
        category = self.request.query_params.get("category")
        status_f = self.request.query_params.get("status")
        if category:
            qs = qs.filter(category=category)
        if status_f:
            qs = qs.filter(status=status_f)

        return qs

    def get_serializer_class(self):
        if self.action in ("create", "partial_update", "update"):
            return FeedbackCreateSerializer
        if self.action == "retrieve":
            return FeedbackDetailSerializer
        return FeedbackListSerializer

    def perform_create(self, serializer):
        from tasks.email import send_feedback_submitted_email
        ticket = serializer.save(
            workspace=self.request.user.workspace,
            submitted_by=self.request.user,
        )
        try:
            send_feedback_submitted_email(str(ticket.id))
        except Exception:
            pass

    def partial_update(self, request, *args, **kwargs):
        ticket = self.get_object()
        is_owner    = request.user.role == "business_owner"
        is_submitter = ticket.submitted_by_id == request.user.pk
        # Submitters can only edit their own ticket while it is still 'new'
        if not is_owner and not (is_submitter and ticket.status == FeedbackTicket.Status.NEW):
            return Response({"detail": "You can only edit your own ticket while its status is New."}, status=403)
        # Submitters cannot change status — guard against it
        if not is_owner:
            request.data.pop("status", None)
        return super().partial_update(request, *args, **kwargs)

    @action(detail=True, methods=["post"], url_path="comment")
    def add_comment(self, request, pk=None):
        ticket = self.get_object()
        serializer = FeedbackCommentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = serializer.save(
            ticket=ticket,
            workspace=request.user.workspace,
            created_by=request.user,
        )
        # Notify ticket submitter if comment is from owner
        if request.user.role == "business_owner" and ticket.submitted_by:
            try:
                from tasks.email import send_feedback_comment_email
                send_feedback_comment_email(str(ticket.id), str(comment.id))
            except Exception:
                pass
        return Response(FeedbackCommentSerializer(comment).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="update-status")
    def update_status(self, request, pk=None):
        if request.user.role != "business_owner":
            return Response({"detail": "Only the business owner can update ticket status."}, status=403)
        ticket = self.get_object()
        new_status = request.data.get("status")
        if new_status not in dict(FeedbackTicket.Status.choices):
            return Response({"detail": "Invalid status."}, status=400)
        ticket.status = new_status
        if new_status == FeedbackTicket.Status.CLOSED:
            ticket.closed_at = timezone.now()
        ticket.save(update_fields=["status", "closed_at", "updated_at"])
        try:
            from tasks.email import send_feedback_status_email
            send_feedback_status_email(str(ticket.id))
        except Exception:
            pass
        return Response(FeedbackDetailSerializer(ticket).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close_ticket(self, request, pk=None):
        if request.user.role != "business_owner":
            return Response({"detail": "Only the business owner can close tickets."}, status=403)
        ticket = self.get_object()
        ticket.status = FeedbackTicket.Status.CLOSED
        ticket.closed_at = timezone.now()
        ticket.save(update_fields=["status", "closed_at", "updated_at"])
        try:
            from tasks.email import send_feedback_status_email
            send_feedback_status_email(str(ticket.id))
        except Exception:
            pass
        return Response({"detail": "Ticket closed."})
