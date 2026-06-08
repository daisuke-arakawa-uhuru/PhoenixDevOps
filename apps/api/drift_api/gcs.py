from __future__ import annotations

from dataclasses import dataclass

from drift_api.errors import ApiError


@dataclass(frozen=True)
class GcsUri:
    bucket: str
    object_name: str

    @property
    def uri(self) -> str:
        return f"gs://{self.bucket}/{self.object_name}"


def parse_gcs_uri(value: str, field_name: str = "uri") -> GcsUri:
    if not isinstance(value, str) or not value.startswith("gs://"):
        raise ApiError(400, "invalid_gcs_uri", f"{field_name} must be a gs:// URI")

    rest = value[len("gs://") :]
    bucket, separator, object_name = rest.partition("/")
    if not bucket or not separator or not object_name:
        raise ApiError(400, "invalid_gcs_uri", f"{field_name} must be a full gs://bucket/object URI")

    return GcsUri(bucket=bucket, object_name=object_name)

