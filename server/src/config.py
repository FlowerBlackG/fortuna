# SPDX-License-Identifier: MulanPSL-2.0
import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Self

from jsonschema import Draft202012Validator


def decode(value: Any, schema: dict[str, Any], directory: Path) -> Any:
    if value is None:
        return None
    if "oneOf" in schema:
        schema = next(branch for branch in schema["oneOf"] if Draft202012Validator(branch).is_valid(value))
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        values = dict(value)
        for key, definition in properties.items():
            if key not in values and "default" in definition:
                values[key] = deepcopy(definition["default"])
        return SimpleNamespace(**{
            key: decode(item, properties.get(key, {}), directory) for key, item in values.items()
        })
    if isinstance(value, list):
        return [decode(item, schema.get("items", {}), directory) for item in value]
    if schema.get("format") == "path":
        return (directory / value).resolve()
    return value


class Config(SimpleNamespace):
    @classmethod
    def load(cls, filename: str | Path) -> Self:
        path = Path(filename).resolve()
        schema = json.loads(Path(__file__).with_name("config.schema.json").read_text(encoding="utf-8"))
        data = json.loads(path.read_text(encoding="utf-8"))
        error = next(iter(Draft202012Validator(schema).iter_errors(data)), None)
        if error:
            location = ".".join(map(str, error.absolute_path)) or "config"
            raise ValueError(f"{location}: {error.message}")
        return cls(**vars(decode(data, schema, path.parent)))
