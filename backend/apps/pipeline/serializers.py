from rest_framework import serializers
from .models import Deal, StageHistory


class StageHistorySerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", read_only=True)

    class Meta:
        model  = StageHistory
        fields = ["id", "from_stage", "to_stage", "changed_by_name", "changed_at"]


class DealSerializer(serializers.ModelSerializer):
    stage_history = StageHistorySerializer(many=True, read_only=True)
    client_name   = serializers.CharField(source="client.full_name", read_only=True)

    class Meta:
        model  = Deal
        fields = ["id", "client", "client_name", "coach", "stage", "stage_changed_at",
                  "deal_value", "source", "notes", "closed_at", "created_at", "stage_history"]
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
    stage = serializers.ChoiceField(choices=Deal.Stage.choices)
