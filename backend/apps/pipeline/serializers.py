from rest_framework import serializers
from .models import Deal, StageHistory, DealProgress


class StageHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", read_only=True)

    class Meta:
        model  = StageHistory
        fields = ["id", "from_stage", "to_stage", "changed_by_name", "changed_at"]


class DealProgressSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", read_only=True)

    class Meta:
        model  = DealProgress
        fields = ["id", "field_name", "old_value", "new_value", "note", "changed_by_name", "changed_at"]


class DealSerializer(serializers.ModelSerializer):
    stage_history = StageHistorySerializer(many=True, read_only=True)
    progress_log  = DealProgressSerializer(many=True, read_only=True)
    client_name    = serializers.CharField(source="client.full_name",  read_only=True)
    client_company = serializers.CharField(source="client.company",   read_only=True)

    class Meta:
        model  = Deal
        fields = [
            "id", "client", "client_name", "client_company", "coach", "stage",
            "stage_changed_at", "deal_value", "deal_type", "tags", "source", "notes",
            "expected_close_date", "probability", "next_action", "next_action_date",
            "alert_stop_date", "closed_at", "created_at", "stage_history", "progress_log",
        ]
        read_only_fields = ["id", "stage_changed_at", "closed_at", "created_at"]

    def create(self, validated_data):
        validated_data["workspace"] = self.context["request"].user.workspace
        validated_data.setdefault("coach", self.context["request"].user)
        deal = super().create(validated_data)
        StageHistory.objects.create(
            workspace=deal.workspace, deal=deal,
            to_stage=deal.stage, changed_by=self.context["request"].user,
        )
        return deal


class AdvanceStageSerializer(serializers.Serializer):
    stage = serializers.CharField(max_length=50)
