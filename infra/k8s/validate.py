#!/usr/bin/env python3
"""Structural checks for the Kubernetes manifests.

    python3 infra/k8s/validate.py

This is not a schema validator — it needs no cluster and no network, and it does not
replace `kubectl apply --dry-run=server`. It checks the things that are wrong *often*
and are invisible in review because each manifest reads correctly on its own:

  * a Service selector that matches no pod, so the Service routes to nothing;
  * a configMapKeyRef or secretKeyRef naming a key that does not exist, so the pod
    crash-loops on a missing variable;
  * an Ingress backend pointing at a Service or port that is not there;
  * an unpinned image, so two nodes can run two different builds;
  * a workload with no resource requests, which makes the scheduler guess;
  * a missing probe, so a rolling update sends traffic to a process that is not ready;
  * a credential-shaped key sitting in a ConfigMap.

Cross-file references are exactly what a per-file review does not catch, which is why
these are checked mechanically instead.
"""
from __future__ import annotations

import glob
import os
import re
import sys

import yaml

BASE = os.path.dirname(os.path.abspath(__file__))
WORKLOADS = {"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"}
SECRET_ISH = re.compile(r"(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|CREDENTIAL)", re.IGNORECASE)

problems: list[str] = []
notes: list[str] = []


def fail(where: str, message: str) -> None:
    problems.append(f"{where}: {message}")


def load_documents() -> list[tuple[str, dict]]:
    docs: list[tuple[str, dict]] = []
    for path in sorted(glob.glob(os.path.join(BASE, "base", "*.yaml"))):
        name = os.path.relpath(path, BASE)
        if name.endswith("kustomization.yaml"):
            continue
        try:
            for doc in yaml.safe_load_all(open(path)):
                if doc:
                    docs.append((name, doc))
        except yaml.YAMLError as error:
            fail(name, f"is not valid YAML — {error}")
    return docs


def generated_configmaps() -> set[str]:
    """ConfigMaps produced by kustomize rather than declared as manifests."""
    path = os.path.join(BASE, "base", "kustomization.yaml")
    kustomization = yaml.safe_load(open(path)) or {}
    names = {entry["name"] for entry in kustomization.get("configMapGenerator", [])}

    # A generator that points at a missing file fails only at build time, so check now.
    for entry in kustomization.get("configMapGenerator", []):
        for spec in entry.get("files", []):
            source = spec.split("=", 1)[-1]
            if not os.path.exists(os.path.join(BASE, "base", source)):
                fail("kustomization.yaml", f"generator '{entry['name']}' references missing {source}")
    return names


def pod_spec_of(doc: dict) -> dict | None:
    kind = doc.get("kind")
    if kind in {"Deployment", "StatefulSet", "DaemonSet"}:
        return doc["spec"]["template"]["spec"]
    if kind == "Job":
        return doc["spec"]["template"]["spec"]
    return None


def pod_labels_of(doc: dict) -> dict:
    if doc.get("kind") in WORKLOADS:
        return doc["spec"]["template"]["metadata"].get("labels", {})
    return {}


def main() -> int:
    docs = load_documents()
    if problems:
        return report()

    configmaps = {d["metadata"]["name"]: set((d.get("data") or {})) for _, d in docs if d["kind"] == "ConfigMap"}
    for name in generated_configmaps():
        configmaps.setdefault(name, set())  # contents come from files; keys unknown here

    secrets = {
        d["metadata"]["name"]: set((d.get("stringData") or {})) | set((d.get("data") or {}))
        for _, d in docs
        if d["kind"] == "Secret"
    }
    services = {d["metadata"]["name"]: d for _, d in docs if d["kind"] == "Service"}
    workloads = [(f, d) for f, d in docs if d["kind"] in WORKLOADS]

    # --- credentials in the wrong place -------------------------------------
    for path, doc in docs:
        if doc["kind"] == "ConfigMap":
            for key in doc.get("data") or {}:
                if SECRET_ISH.search(key):
                    fail(path, f"ConfigMap '{doc['metadata']['name']}' holds credential-shaped key '{key}'")

    # --- workloads ----------------------------------------------------------
    for path, doc in workloads:
        kind, name = doc["kind"], doc["metadata"]["name"]
        where = f"{path} ({kind}/{name})"
        spec = pod_spec_of(doc)
        assert spec is not None

        if not spec.get("securityContext", {}).get("runAsNonRoot"):
            fail(where, "pod securityContext does not set runAsNonRoot: true")

        declared_volumes = {v["name"] for v in spec.get("volumes", [])}

        for container in spec.get("containers", []):
            cname = container["name"]
            image = container.get("image", "")

            if ":" not in image.rsplit("/", 1)[-1]:
                fail(where, f"container '{cname}' image '{image}' has no tag")
            elif image.endswith(":latest"):
                fail(where, f"container '{cname}' uses :latest, which is not reproducible")

            resources = container.get("resources", {})
            for section in ("requests", "limits"):
                if not resources.get(section):
                    fail(where, f"container '{cname}' has no resources.{section}")

            csc = container.get("securityContext", {})
            if csc.get("allowPrivilegeEscalation") is not False:
                fail(where, f"container '{cname}' does not set allowPrivilegeEscalation: false")
            if "ALL" not in (csc.get("capabilities", {}).get("drop") or []):
                fail(where, f"container '{cname}' does not drop all capabilities")

            # Jobs run to completion; probes only make sense for long-lived workloads.
            if kind != "Job":
                for probe in ("readinessProbe", "livenessProbe"):
                    if probe not in container:
                        fail(where, f"container '{cname}' has no {probe}")

            port_names = {p["name"] for p in container.get("ports", []) if "name" in p}
            for probe in ("readinessProbe", "livenessProbe"):
                target = container.get(probe, {}).get("httpGet", {}).get("port")
                if isinstance(target, str) and target not in port_names:
                    fail(where, f"{probe} for '{cname}' targets port '{target}', which is not declared")

            for mount in container.get("volumeMounts", []):
                if mount["name"] not in declared_volumes and kind != "StatefulSet":
                    fail(where, f"container '{cname}' mounts undeclared volume '{mount['name']}'")

            # --- references to configuration -----------------------------------
            for entry in container.get("envFrom", []):
                ref = entry.get("configMapRef", {}).get("name")
                if ref and ref not in configmaps:
                    fail(where, f"envFrom references missing ConfigMap '{ref}'")

            for env in container.get("env", []):
                source = env.get("valueFrom") or {}
                cm = source.get("configMapKeyRef")
                sec = source.get("secretKeyRef")
                if cm:
                    if cm["name"] not in configmaps:
                        fail(where, f"env '{env['name']}' references missing ConfigMap '{cm['name']}'")
                    elif configmaps[cm["name"]] and cm["key"] not in configmaps[cm["name"]]:
                        fail(where, f"env '{env['name']}' references missing key '{cm['key']}' in ConfigMap '{cm['name']}'")
                if sec:
                    if sec["name"] not in secrets:
                        fail(where, f"env '{env['name']}' references missing Secret '{sec['name']}'")
                    elif sec["key"] not in secrets[sec["name"]]:
                        fail(where, f"env '{env['name']}' references missing key '{sec['key']}' in Secret '{sec['name']}'")

            for volume in spec.get("volumes", []):
                ref = (volume.get("configMap") or {}).get("name")
                if ref and ref not in configmaps:
                    fail(where, f"volume '{volume['name']}' references missing ConfigMap '{ref}'")

    # --- services select something ------------------------------------------
    all_pod_labels = [pod_labels_of(d) for _, d in workloads]
    for path, doc in docs:
        if doc["kind"] != "Service":
            continue
        selector = doc["spec"].get("selector") or {}
        if not selector:
            fail(path, f"Service '{doc['metadata']['name']}' has no selector")
            continue
        if not any(all(labels.get(k) == v for k, v in selector.items()) for labels in all_pod_labels):
            fail(path, f"Service '{doc['metadata']['name']}' selector {selector} matches no pod template")

    # --- ingress points at real services -------------------------------------
    for path, doc in docs:
        if doc["kind"] != "Ingress":
            continue
        for rule in doc["spec"].get("rules", []):
            for http_path in rule.get("http", {}).get("paths", []):
                backend = http_path["backend"]["service"]
                service = services.get(backend["name"])
                if not service:
                    fail(path, f"Ingress backend references missing Service '{backend['name']}'")
                    continue
                wanted = backend["port"].get("number")
                available = {p["port"] for p in service["spec"]["ports"]}
                if wanted not in available:
                    fail(path, f"Ingress targets {backend['name']}:{wanted}, which exposes {sorted(available)}")

    notes.append(f"{len(docs)} manifests, {len(workloads)} workloads, {len(services)} services checked")
    return report()


def report() -> int:
    for note in notes:
        print(note)
    if problems:
        print(f"\n{len(problems)} problem(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        return 1
    print("\nAll manifest checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
