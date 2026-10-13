import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText } from "../src/denylist.mjs";

test("flags original identifiers in their leaking roles", () => {
  const bad = [
    "kubectl config use-context k8s",
    "kubectl --context=hk8s get pods",
    "    context: ek8s",
    "ssh mk8s-master-0",
    "kubectl -n internal get pods",
    "  namespace: internal",
    "name: front-end-svc",
    "echo 3 > /opt/KUSC00402/kusc00402.txt",
    "path: /srv/app-data",
    "ETCDCTL snapshot save /var/lib/backup/etcd-snapshot.db",
    "nodeSelector: {disk: ssd}",
    "kubectl label node x disk=ssd",
    "serviceaccount cicd-token in app-team1",
    "write the answer to /opt/KUQX0815/out.txt",
    "task kucm00302 asks for",
    "kubectl config use-context wk8s",
  ];
  for (const line of bad) assert.ok(scanText(line).length > 0, `expected a hit for: ${line}`);
});

test("does not flag legitimate uses of generic tokens", () => {
  const ok = [
    "skills: [k8s.cli.contexts, k8s.scheduling.cordon-drain]",
    "The internal network uses Kube-OVN.",
    "kubectl config use-context qm-yard",
    "nodeSelector: {storage-tier: nvme}",
    "image: kubeadm:1.35",
    "kubectl -n kube-system get pods",
  ];
  for (const line of ok) assert.deepEqual(scanText(line), [], `unexpected hit for: ${line}`);
});
