#!/usr/bin/env bash
# etcdctl with the grader's own client identity (never the learner's files).
exec etcdctl --endpoints=https://127.0.0.1:2379 --dial-timeout=2s --command-timeout=3s \
  --cacert=/etc/qm-etcd/pki/ca.crt --cert=/etc/qm-etcd/pki/grader.crt --key=/etc/qm-etcd/pki/grader.key "$@"
