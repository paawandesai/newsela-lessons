"""
Creates (or reports) the Lesson Studio host on AWS Lightsail.

One 4 GB instance in us-west-2 with a static IP, only ports 80 and 443 open
(plus 22 for Lightsail's browser SSH), running docker compose behind Caddy
with HTTPS on an sslip.io hostname.

Reads from the environment, never from arguments:
  AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION (default us-west-2)
  ANTHROPIC_API_KEY (or ANTHROPIC_NEWSELA_API_KEY)
  REPO_URL   https://<deploy-token-user>:<token>@host/group/project.git (read-only deploy token)
  BRANCH     branch to deploy (default main)
  SEED_PASSWORD  password for the three demo accounts
Generated on first run and kept only on the instance: AUTH_SECRET, POSTGRES_PASSWORD.

Usage: python deploy/deploy.py [--name lesson-studio]
"""

import argparse
import os
import secrets
import sys
import time
from pathlib import Path

import boto3

HERE = Path(__file__).parent


def need(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(f"Set {name} first.")
    return value


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="lesson-studio")
    args = ap.parse_args()

    region = os.environ.get("AWS_REGION", "us-west-2")
    ls = boto3.client("lightsail", region_name=region)
    name, ip_name = args.name, f"{args.name}-ip"

    existing = {i["name"]: i for i in ls.get_instances()["instances"]}
    if name in existing:
        ip = existing[name].get("publicIpAddress")
        print(f"{name} already exists at {ip}: https://lessons.{ip.replace('.', '-')}.sslip.io")
        return

    # Static IP first, so the hostname is known before the instance boots.
    try:
        ls.allocate_static_ip(staticIpName=ip_name)
    except ls.exceptions.InvalidInputException:
        pass  # already allocated by an earlier, interrupted run
    ip = ls.get_static_ip(staticIpName=ip_name)["staticIp"]["ipAddress"]
    host = f"lessons.{ip.replace('.', '-')}.sslip.io"

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY") or need("ANTHROPIC_NEWSELA_API_KEY")
    auth_secret = secrets.token_hex(32)
    pg_password = secrets.token_hex(16)
    env_file = "\n".join(
        [
            f"SITE_ADDRESS={host}",
            f"NEXT_PUBLIC_COLLAB_URL=wss://{host}/collab",
            f"AUTH_SECRET={auth_secret}",
            f"POSTGRES_PASSWORD={pg_password}",
            f"ANTHROPIC_API_KEY={anthropic_key}",
            f"SEED_PASSWORD={need('SEED_PASSWORD')}",
            f"GENERATION_MODEL={os.environ.get('GENERATION_MODEL', 'claude-opus-5-5')}",
            f"UNIT_SPEND_CAP_USD={os.environ.get('UNIT_SPEND_CAP_USD', '25')}",
        ]
    )
    script = (
        (HERE / "user-data.sh")
        .read_text()
        .replace("__SITE_HOST__", host)
        .replace("__REPO_URL__", need("REPO_URL"))
        .replace("__BRANCH__", os.environ.get("BRANCH", "main"))
        .replace("__ENV_FILE__", env_file)
    )
    # Lightsail appends the launch script to its own setup and runs the result with
    # /bin/sh, which ignores our #!/bin/bash line. Write the real script out and run it with bash.
    user_data = f"mkdir -p /root/lesson-studio\ncat > /root/lesson-studio/setup.sh <<'SETUP_EOF'\n{script}\nSETUP_EOF\nbash /root/lesson-studio/setup.sh\n"

    bundle = next(
        b["bundleId"]
        for b in sorted(ls.get_bundles()["bundles"], key=lambda b: b["price"])
        if b["isActive"] and b["ramSizeInGb"] == 4.0 and "LINUX_UNIX" in b["supportedPlatforms"] and b.get("publicIpv4AddressCount", 0) >= 1
    )
    blueprint = next(
        b["blueprintId"]
        for b in ls.get_blueprints()["blueprints"]
        if b["isActive"] and b["blueprintId"].startswith("ubuntu_24")
    )
    zone = ls.get_regions(includeAvailabilityZones=True)
    zone = next(r for r in zone["regions"] if r["name"] == region)["availabilityZones"][0]["zoneName"]

    print(f"Creating {name} ({bundle}, {blueprint}) in {zone}")
    ls.create_instances(
        instanceNames=[name],
        availabilityZone=zone,
        blueprintId=blueprint,
        bundleId=bundle,
        userData=user_data,
        tags=[{"key": "app", "value": "lesson-studio"}],
    )
    while ls.get_instance_state(instanceName=name)["state"]["name"] != "running":
        time.sleep(5)
    ls.attach_static_ip(staticIpName=ip_name, instanceName=name)
    ls.put_instance_public_ports(
        instanceName=name,
        portInfos=[
            {"fromPort": 80, "toPort": 80, "protocol": "tcp"},
            {"fromPort": 443, "toPort": 443, "protocol": "tcp"},
            {"fromPort": 22, "toPort": 22, "protocol": "tcp", "cidrListAliases": ["lightsail-connect"]},
        ],
    )
    # The generated secrets live only in the instance's .env; they are never printed.
    print(f"Instance is running. Setup takes about 10 minutes, then: https://{host}")


if __name__ == "__main__":
    main()
