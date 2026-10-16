#!/usr/bin/env python3
import base64
import json
import os
import pathlib
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request


ROOT = pathlib.Path("/opt/yubao-dailyplan")
STATE_PATH = ROOT / "data/state.json"
UPLOAD_DIR = ROOT / "uploads"
BASE_URL = "http://127.0.0.1:8787"
COMPOSE = [
    "docker", "compose", "--project-directory", str(ROOT),
    "-f", str(ROOT / "docker-compose.yml"),
]


def request_json(path, method="GET", body=None, token=None):
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(BASE_URL + path, data=data, headers=headers, method=method)
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status, json.loads(response.read().decode("utf-8"))


def action(action_type, payload, token=None):
    return request_json("/api/action", "POST", {"type": action_type, "payload": payload}, token)[1]


def wait_for_health(timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            status, payload = request_json("/healthz")
            if status == 200 and payload.get("ok") is True:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("service did not become healthy")


def restart_app():
    subprocess.run(COMPOSE + ["restart", "app"], check=True, stdout=subprocess.DEVNULL)
    wait_for_health()


def find_named(items, name):
    return next(item for item in items if item.get("name", item.get("title")) == name)


def upload_data(name, mime_type, raw, token):
    payload = {
        "name": name,
        "purpose": "acceptance_test",
        "dataUrl": f"data:{mime_type};base64,{base64.b64encode(raw).decode('ascii')}",
    }
    return request_json("/api/upload", "POST", payload, token)[1]


def restore_state(original_bytes, original_stat, original_uploads):
    temporary = STATE_PATH.with_suffix(".acceptance-restore")
    temporary.write_bytes(original_bytes)
    os.chmod(temporary, original_stat.st_mode & 0o777)
    os.chown(temporary, original_stat.st_uid, original_stat.st_gid)
    os.replace(temporary, STATE_PATH)
    for candidate in UPLOAD_DIR.iterdir():
        if candidate.is_file() and candidate.name not in original_uploads:
            candidate.unlink()
    restart_app()


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: acceptance.py VIDEO_FILE")
    video_path = pathlib.Path(sys.argv[1])
    if not video_path.is_file():
        raise SystemExit(f"missing video: {video_path}")

    timestamp = time.strftime("%Y%m%d-%H%M%S")
    original_bytes = STATE_PATH.read_bytes()
    original_state = json.loads(original_bytes.decode("utf-8"))
    original_stat = STATE_PATH.stat()
    original_uploads = {path.name for path in UPLOAD_DIR.iterdir() if path.is_file()}
    snapshot_path = ROOT / "backups" / f"preacceptance-{timestamp}.json"
    snapshot_path.write_bytes(original_bytes)
    os.chmod(snapshot_path, 0o600)

    report = {
        "timestamp": timestamp,
        "snapshot": str(snapshot_path),
        "checks": {},
        "restored": False,
    }

    try:
        _, baseline = request_json("/api/state")
        baseline_balance = baseline["wallet"]["balance"]
        baseline_redemptions = len(baseline["redemptions"])
        baseline_equipped = dict(baseline["equipped"])

        _, login = request_json("/api/login", "POST", {"pin": original_state["family"]["pin"]})
        token = login["token"]
        status, session = request_json("/api/session", token=token)
        report["checks"]["parent_login"] = status == 200 and session.get("authenticated") is True

        suffix = timestamp[-6:]
        task_name = f"云端验收任务-{suffix}"
        state = action("createTask", {
            "title": task_name,
            "subject": "其他",
            "scheduleType": "once",
            "description": "自动验收任务，完成后恢复测试前数据。",
            "photoPolicy": "none",
            "reward": 2,
            "due": "今天完成",
            "guideImage": None,
        }, token)
        task = find_named(state["tasks"], task_name)
        report["checks"]["parent_create_task"] = task["status"] == "todo"

        _, state = request_json("/api/task-submissions", "POST", {"taskId": task["id"]})
        task = next(item for item in state["tasks"] if item["id"] == task["id"])
        report["checks"]["child_submit_task"] = task["status"] == "pending"

        state = action("confirmTask", {"id": task["id"]}, token)
        task = next(item for item in state["tasks"] if item["id"] == task["id"])
        report["checks"]["parent_confirm_task"] = (
            task["status"] == "done" and state["wallet"]["balance"] == baseline_balance + 2
        )

        video_upload = upload_data("acceptance-preview.webm", "video/webm", video_path.read_bytes(), token)
        character_static = next(item["staticUrl"] for item in baseline["digitalRewards"] if item["type"] == "character")
        background_static = next(item["staticUrl"] for item in baseline["digitalRewards"] if item["type"] == "background")
        pet_static = next(item["staticUrl"] for item in baseline["digitalRewards"] if item["type"] == "pet")

        reward_specs = [
            ("character", f"验收人物-{suffix}", character_static, video_upload["url"], "video", 1),
            ("background", f"验收背景-{suffix}", background_static, "", "static", 999),
            ("pet", f"验收宠物-{suffix}", pet_static, "", "static", 999),
        ]
        for reward_type, name, static_url, motion_url, media_mode, price in reward_specs:
            state = action("createDigitalReward", {
                "rewardType": reward_type,
                "name": name,
                "description": "云端自动验收奖励。",
                "price": price,
                "staticUrl": static_url,
                "motionUrl": motion_url,
                "mediaMode": media_mode,
                "active": True,
            }, token)
        created_types = {item["type"] for item in state["digitalRewards"] if item["name"].startswith("验收")}
        report["checks"]["digital_reward_three_types"] = created_types == {"character", "background", "pet"}

        transparent_png = base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
        )
        image_upload = upload_data("acceptance-reward.png", "image/png", transparent_png, token)
        built_in_image = baseline["realRewards"][0]["imageUrl"]
        state = action("createRealReward", {
            "name": f"验收内置配图-{suffix}", "category": "自动验收", "description": "内置配图验收。",
            "price": 1, "remaining": 1, "validUntil": "2027-12-31", "cooldownDays": 0,
            "note": "", "imageSource": "built_in", "imageAssetId": "acceptance-built-in",
            "imageUrl": built_in_image, "active": True,
        }, token)
        state = action("createRealReward", {
            "name": f"验收上传配图-{suffix}", "category": "自动验收", "description": "上传配图验收。",
            "price": 1, "remaining": 1, "validUntil": "2027-12-31", "cooldownDays": 0,
            "note": "", "imageSource": "custom_upload", "imageAssetId": "",
            "imageUrl": image_upload["url"], "active": True,
        }, token)
        acceptance_real = [item for item in state["realRewards"] if item["name"].startswith("验收")]
        report["checks"]["real_reward_both_image_sources"] = {
            item["imageSource"] for item in acceptance_real
        } == {"built_in", "custom_upload"}

        character = find_named(state["digitalRewards"], f"验收人物-{suffix}")
        state = action("purchaseDigital", {"id": character["id"]})
        purchased = next(item for item in state["digitalRewards"] if item["id"] == character["id"])
        report["checks"]["digital_purchase"] = (
            purchased["owned"] is True
            and state["wallet"]["balance"] == baseline_balance + 1
            and len(state["redemptions"]) == baseline_redemptions + 1
            and state["equipped"] == baseline_equipped
        )

        range_request = urllib.request.Request(
            BASE_URL + video_upload["url"], headers={"Range": "bytes=0-99"}, method="GET"
        )
        with urllib.request.urlopen(range_request, timeout=20) as response:
            report["checks"]["video_range_playback"] = response.status == 206 and len(response.read()) == 100

        restart_app()
        _, persisted = request_json("/api/state")
        report["checks"]["restart_persistence"] = (
            any(item["title"] == task_name and item["status"] == "done" for item in persisted["tasks"])
            and any(item["name"] == f"验收人物-{suffix}" and item["owned"] for item in persisted["digitalRewards"])
            and persisted["wallet"]["balance"] == baseline_balance + 1
        )
    finally:
        restore_state(original_bytes, original_stat, original_uploads)
        _, restored = request_json("/api/state")
        report["restored"] = (
            restored["wallet"]["balance"] == original_state["wallet"]["balance"]
            and len(restored["tasks"]) == len(original_state["tasks"])
            and len(restored["digitalRewards"]) == len(original_state["digitalRewards"])
            and len(restored["realRewards"]) == len(original_state["realRewards"])
            and len(restored["redemptions"]) == len(original_state["redemptions"])
            and {path.name for path in UPLOAD_DIR.iterdir() if path.is_file()} == original_uploads
        )
        report_path = ROOT / "backups" / f"acceptance-{timestamp}.json"
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"report": str(report_path), **report}, ensure_ascii=False, indent=2))

    if not report["restored"] or not all(report["checks"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
