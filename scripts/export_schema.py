from pathlib import Path
import json
from modellab.schema import ModelDoc

root = Path(__file__).resolve().parents[1]
(root / "docs/model.schema.json").write_text(
    json.dumps(ModelDoc.model_json_schema(), ensure_ascii=False, indent=2)
)
