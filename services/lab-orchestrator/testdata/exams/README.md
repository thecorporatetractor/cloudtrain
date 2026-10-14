# Exam engine test fixtures

Not curriculum content: a small exam (`exams.yaml`, `sim-test-k8s-dev`) and six
exam-task labs (`tasks/`) that exist only to verify the exam engine
(`labctl exam compile|draw|run`, the ExamSession controller, the gateway and
web flows). Fictional Quillmoor Logistics scenario, cheap virtual-cluster
topology:

| Objective | Weight | Draws | Pool (cluster) |
|---|---|---|---|
| ckad:deployment | 40 | 1 | xt-scale-manifest-api, xt-set-image-tally (exam-core) |
| ckad:environment-config-security | 35 | 1 | xt-configmap-key, xt-secret-literal (exam-core) |
| ckad:services-networking | 25 | 1 | xt-expose-clusterip, xt-service-selector-tier (exam-edge) |

Every task enters through the same `workstation` (jumphost) and names its
context; the shared environment of an attempt is the union of the drawn tasks'
nodes (workstation + exam-core + exam-edge here). `xt-configmap-key` carries an
`exam.rerun` action (the saved manifest is re-applied and must report
`unchanged`), so the exam's `idempotencyRerun` rule is exercised on vclusters.

```sh
bin/labctl exam compile --exams testdata/exams/exams.yaml --labs testdata/exams/tasks sim-test-k8s-dev
bin/labctl exam draw --exams testdata/exams/exams.yaml --labs testdata/exams/tasks --seed 7 sim-test-k8s-dev
```
