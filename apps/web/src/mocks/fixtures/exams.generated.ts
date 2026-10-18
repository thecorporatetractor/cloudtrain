// Generated from content/curriculum.yaml (exams and their pool tasks' titles) for the mock API.
// Regenerate with the snippet in apps/web/src/mocks/fixtures/exams.ts if the curriculum changes.
/* eslint-disable */
import type { ExamDomain, ExamRules, RetakePolicy } from '@/api/types';

export interface FixtureExam {
  id: string; title: string; domain: ExamDomain; alignsTo: string[]; disclaimer: string; format: 'practical' | 'practical-simulation';
  description?: string; simulationNote?: string; durationMinutes: number; passMark: number; passMarkNote?: string; taskCount: number;
  environment: 'shared' | 'per-task'; rules: ExamRules; retakePolicy: RetakePolicy; reportIncludes: string[];
  blueprint: { objective: string; name: string; weight: number; tasks: number; pool: string[] }[];
}
export interface FixtureTask { title: string; oneLine: string; minutes: number; skills: string[]; difficulty: string }

export const fixtureExams: FixtureExam[] = [
 {
  "id": "sim-k8s-admin",
  "title": "Kubernetes administrator practical exam simulation",
  "domain": "kubernetes",
  "alignsTo": [
   "cka"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKA is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 120,
  "passMark": 66,
  "passMarkNote": "The real exam publishes a pass mark; ours (66 %) is a CloudTrain setting and may be recalibrated from pilot data.",
  "taskCount": 17,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "offline copy of the Kubernetes documentation and man pages only",
   "notes": "each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere"
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "weighted score and pass/fail against the pass mark",
   "per-objective percent",
   "per-task pass/fail with learner-safe check messages",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for the weakest objectives"
  ],
  "blueprint": [
   {
    "objective": "cka:storage",
    "name": "Storage",
    "weight": 10,
    "tasks": 2,
    "pool": [
     "xka-pv-claim-mount",
     "xka-default-storageclass",
     "xka-retain-reclaim",
     "xka-expand-claim"
    ]
   },
   {
    "objective": "cka:troubleshooting",
    "name": "Troubleshooting",
    "weight": 30,
    "tasks": 5,
    "pool": [
     "xka-kubelet-stopped",
     "xka-controller-manager-flag",
     "xka-top-cpu-pod",
     "xka-previous-logs-error",
     "xka-service-selector-fix",
     "xka-coredns-down",
     "xka-tainted-node-count",
     "xka-crictl-container-id",
     "xka-events-failing-pod",
     "xka-apiserver-etcd-endpoint"
    ]
   },
   {
    "objective": "cka:workloads-scheduling",
    "name": "Workloads and scheduling",
    "weight": 15,
    "tasks": 3,
    "pool": [
     "xka-hpa-memory",
     "xka-rollout-undo",
     "xka-secret-env-volume",
     "xka-required-affinity",
     "xka-toleration-control-plane",
     "xka-sidecar-shared-log"
    ]
   },
   {
    "objective": "cka:cluster-architecture",
    "name": "Cluster architecture, installation and configuration",
    "weight": 25,
    "tasks": 4,
    "pool": [
     "xka-etcd-snapshot-save",
     "xka-worker-join",
     "xka-node-upgrade-minor",
     "xka-clusterrole-binding",
     "xka-helm-install-values",
     "xka-kustomize-apply",
     "xka-crd-custom-resource",
     "xka-csr-user-access"
    ]
   },
   {
    "objective": "cka:services-networking",
    "name": "Services and networking",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xka-netpol-egress-db",
     "xka-nodeport-fixed",
     "xka-ingress-host-rule",
     "xka-httproute-split",
     "xka-dns-lookup-record",
     "xka-loadbalancer-address"
    ]
   }
  ]
 },
 {
  "id": "sim-k8s-developer",
  "title": "Kubernetes application developer practical exam simulation",
  "domain": "kubernetes",
  "alignsTo": [
   "ckad"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKAD is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 120,
  "passMark": 66,
  "passMarkNote": "The real exam publishes a pass mark; ours (66 %) is a CloudTrain setting and may be recalibrated from pilot data.",
  "taskCount": 16,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "offline copy of the Kubernetes documentation and man pages only",
   "notes": "each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere"
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "weighted score and pass/fail against the pass mark",
   "per-objective percent",
   "per-task pass/fail with learner-safe check messages",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for the weakest objectives"
  ],
  "blueprint": [
   {
    "objective": "ckad:design-build",
    "name": "Application design and build",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xkd-cronjob-cleanup",
     "xkd-job-completions",
     "xkd-init-container-seed",
     "xkd-build-tag-image",
     "xkd-pvc-mount-pod",
     "xkd-workload-kind-choice"
    ]
   },
   {
    "objective": "ckad:deployment",
    "name": "Application deployment",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xkd-canary-share",
     "xkd-bluegreen-switch",
     "xkd-rolling-strategy",
     "xkd-helm-upgrade-rollback",
     "xkd-kustomize-image-tag",
     "xkd-scale-and-pause"
    ]
   },
   {
    "objective": "ckad:observability-maintenance",
    "name": "Application observability and maintenance",
    "weight": 15,
    "tasks": 3,
    "pool": [
     "xkd-readiness-http",
     "xkd-liveness-exec-fix",
     "xkd-deprecated-manifest",
     "xkd-logs-container-select",
     "xkd-top-memory-report",
     "xkd-debug-distroless"
    ]
   },
   {
    "objective": "ckad:environment-config-security",
    "name": "Application environment, configuration and security",
    "weight": 25,
    "tasks": 4,
    "pool": [
     "xkd-configmap-volume",
     "xkd-secret-env-from",
     "xkd-security-context-user",
     "xkd-requests-limits",
     "xkd-quota-namespace",
     "xkd-serviceaccount-pod",
     "xkd-role-configmaps",
     "xkd-custom-resource-create"
    ]
   },
   {
    "objective": "ckad:services-networking",
    "name": "Services and networking",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xkd-clusterip-expose",
     "xkd-netpol-allow-frontend",
     "xkd-ingress-path",
     "xkd-service-port-fix",
     "xkd-nodeport-expose",
     "xkd-named-port-service"
    ]
   }
  ]
 },
 {
  "id": "sim-k8s-security",
  "title": "Kubernetes security specialist practical exam simulation",
  "domain": "kubernetes",
  "alignsTo": [
   "cks"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by the Cloud Native Computing Foundation and The Linux Foundation. CKS is a trademark of the Cloud Native Computing Foundation and The Linux Foundation. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 120,
  "passMark": 67,
  "passMarkNote": "The real exam publishes a pass mark; ours (67 %) is a CloudTrain setting and may be recalibrated from pilot data.",
  "taskCount": 15,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "offline copy of the Kubernetes documentation and man pages only",
   "notes": "each task names the context to use; tasks share the multi-cluster environment, so a change outside the task scope can cost points elsewhere"
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "weighted score and pass/fail against the pass mark",
   "per-objective percent",
   "per-task pass/fail with learner-safe check messages",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for the weakest objectives"
  ],
  "blueprint": [
   {
    "objective": "cks:cluster-setup",
    "name": "Cluster setup",
    "weight": 15,
    "tasks": 2,
    "pool": [
     "xks-default-deny-ns",
     "xks-metadata-egress-block",
     "xks-ingress-tls-secret",
     "xks-cis-kubelet-fix"
    ]
   },
   {
    "objective": "cks:cluster-hardening",
    "name": "Cluster hardening",
    "weight": 15,
    "tasks": 2,
    "pool": [
     "xks-rbac-reduce",
     "xks-sa-automount",
     "xks-apiserver-anonymous",
     "xks-node-restriction"
    ]
   },
   {
    "objective": "cks:system-hardening",
    "name": "System hardening",
    "weight": 10,
    "tasks": 2,
    "pool": [
     "xks-apparmor-profile-pod",
     "xks-seccomp-localhost",
     "xks-remove-service-port",
     "xks-kubelet-webhook-authz"
    ]
   },
   {
    "objective": "cks:microservice-vulnerabilities",
    "name": "Minimising microservice vulnerabilities",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xks-pss-restricted",
     "xks-runtimeclass-move",
     "xks-encryption-config",
     "xks-immutable-secret",
     "xks-drop-privileged",
     "xks-wireguard-cni"
    ]
   },
   {
    "objective": "cks:supply-chain-security",
    "name": "Supply chain security",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xks-scan-pick-image",
     "xks-sbom-spdx",
     "xks-registry-vap",
     "xks-dockerfile-hardening",
     "xks-manifest-static-fix",
     "xks-signature-verify"
    ]
   },
   {
    "objective": "cks:monitoring-runtime-security",
    "name": "Monitoring, logging and runtime security",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xks-audit-policy-secrets",
     "xks-runtime-alert-scale",
     "xks-detection-rule-output",
     "xks-readonly-rootfs",
     "xks-audit-log-reader",
     "xks-incident-isolate-pod"
    ]
   }
  ]
 },
 {
  "id": "sim-linux-sysadmin",
  "title": "Linux system administrator practical exam simulation",
  "domain": "linux",
  "alignsTo": [
   "lfcs"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by The Linux Foundation. LFCS is a trademark of The Linux Foundation. This exam simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 120,
  "passMark": 67,
  "passMarkNote": "The certifying body does not publish a fixed pass mark for every exam version; 67% is a CloudTrain setting to be calibrated from pilot data.",
  "taskCount": 18,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "local man pages and /usr/share/doc only; no internet",
   "notes": "One shared environment: an Ubuntu LTS VM as the main host plus one Enterprise Linux VM for the tasks that need SELinux or EL tooling; tasks state which host to use. The exam is distribution-neutral, so checks grade end state, not the tool used."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks from each objective pool and new parameters"
  },
  "reportIncludes": [
   "per-objective percentage against the pass mark",
   "per-task pass/fail with learner-safe check messages (no expected values)",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for objectives below 60%"
  ],
  "blueprint": [
   {
    "objective": "lfcs:operations-deployment",
    "name": "Operations deployment",
    "weight": 25,
    "tasks": 5,
    "pool": [
     "xlf-persist-sysctl-pair",
     "xlf-repo-install-hold",
     "xlf-timer-housekeeping",
     "xlf-kill-memory-hog",
     "xlf-recover-fstab-boot",
     "xlf-container-restart-policy",
     "xlf-selinux-enforce-fix",
     "xlf-libvirt-autostart",
     "xlf-cron-as-user",
     "xlf-module-load-options"
    ]
   },
   {
    "objective": "lfcs:networking",
    "name": "Networking",
    "weight": 25,
    "tasks": 4,
    "pool": [
     "xlf-static-ip-netplan",
     "xlf-static-route-persist",
     "xlf-nat-redirect",
     "xlf-firewall-subnet-only",
     "xlf-sshd-restrict-group",
     "xlf-nginx-lb-two-backends",
     "xlf-bond-config",
     "xlf-time-sync-server"
    ]
   },
   {
    "objective": "lfcs:storage",
    "name": "Storage",
    "weight": 20,
    "tasks": 4,
    "pool": [
     "xlf-lvm-new-volume",
     "xlf-lvm-grow-fs",
     "xlf-swap-file",
     "xlf-nfs-client-mount",
     "xlf-autofs-map",
     "xlf-repair-xfs",
     "xlf-raid1-create",
     "xlf-tmpfs-mount"
    ]
   },
   {
    "objective": "lfcs:essential-commands",
    "name": "Essential commands",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xlf-find-and-copy",
     "xlf-git-commit-push",
     "xlf-cert-self-signed",
     "xlf-free-disk-space",
     "xlf-service-unit-create",
     "xlf-archive-compare"
    ]
   },
   {
    "objective": "lfcs:users-groups",
    "name": "Users and groups",
    "weight": 10,
    "tasks": 2,
    "pool": [
     "xlf-user-limits",
     "xlf-acl-shared-dir",
     "xlf-skel-profile",
     "xlf-ldap-user-login"
    ]
   }
  ]
 },
 {
  "id": "sim-el-sysadmin",
  "title": "Enterprise Linux administrator practical exam simulation",
  "domain": "linux",
  "alignsTo": [
   "rhcsa-aligned"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by Red Hat, Inc. RHCSA is a trademark of Red Hat, Inc. This exam simulation covers objectives aligned to that exam; passing it confers no certification. It runs on a CloudTrain Enterprise Linux image based on AlmaLinux.",
  "format": "practical",
  "durationMinutes": 180,
  "passMark": 70,
  "passMarkNote": "Mirrors the commonly published 210/300 threshold of the real exam; the real exam publishes no objective weights, so blueprint weights are CloudTrain weights.",
  "taskCount": 20,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": true,
   "idempotencyRerun": false,
   "partialCredit": "per-task",
   "docsAllowed": "local man pages and offline product documentation only; no internet",
   "notes": "Two Enterprise Linux 10 VMs (node 1 and node 2). Both VMs are rebooted before grading and every task is graded after the reboot; configuration that does not persist scores zero. RHEL 9 variant toggle: swaps the Flatpak and timer tasks for container (Podman/Quadlet) and SELinux-denial tasks and adds set-GID directory tasks."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks from each objective pool and new parameters"
  },
  "reportIncludes": [
   "per-objective percentage against the pass mark",
   "per-task pass/fail with learner-safe check messages (no expected values)",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for objectives below 60%",
   "which tasks failed only after the reboot (persistence failures)"
  ],
  "blueprint": [
   {
    "objective": "rhcsa-aligned:essential-tools",
    "name": "Essential tools (shell, files, links, archives, permissions, docs)",
    "weight": 15,
    "tasks": 3,
    "pool": [
     "xel-grep-redirect-file",
     "xel-find-owner-copy",
     "xel-tar-bzip-archive",
     "xel-links-hard-soft",
     "xel-permissions-umask",
     "xel-scp-remote-copy"
    ]
   },
   {
    "objective": "rhcsa-aligned:software",
    "name": "Repositories, RPM packages and Flatpak",
    "weight": 8,
    "tasks": 2,
    "pool": [
     "xel-repo-config",
     "xel-install-remove-rpm",
     "xel-flatpak-remote",
     "xel-update-single-pkg"
    ]
   },
   {
    "objective": "rhcsa-aligned:scripts",
    "name": "Simple shell scripts",
    "weight": 7,
    "tasks": 1,
    "pool": [
     "xel-script-args-loop",
     "xel-script-find-report"
    ]
   },
   {
    "objective": "rhcsa-aligned:running-systems",
    "name": "Operating running systems (boot, targets, processes, tuning, logs)",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xel-root-password-reset",
     "xel-tuned-profile",
     "xel-journal-persistent",
     "xel-nice-process"
    ]
   },
   {
    "objective": "rhcsa-aligned:local-storage",
    "name": "Partitions, LVM and swap",
    "weight": 12,
    "tasks": 3,
    "pool": [
     "xel-gpt-partition-lv",
     "xel-swap-partition",
     "xel-mount-by-label",
     "xel-add-pv-extend-vg",
     "xel-mount-by-uuid",
     "xel-remove-lv-safely"
    ]
   },
   {
    "objective": "rhcsa-aligned:filesystems",
    "name": "File systems, NFS and autofs",
    "weight": 10,
    "tasks": 2,
    "pool": [
     "xel-resize-lv-fs",
     "xel-autofs-home",
     "xel-vfat-mount",
     "xel-fix-dir-permissions"
    ]
   },
   {
    "objective": "rhcsa-aligned:deploy-maintain",
    "name": "Scheduling, services, time, bootloader",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xel-chrony-client",
     "xel-default-target",
     "xel-timer-job",
     "xel-kernel-arg"
    ]
   },
   {
    "objective": "rhcsa-aligned:networking",
    "name": "Basic networking and firewall",
    "weight": 8,
    "tasks": 2,
    "pool": [
     "xel-nmcli-static",
     "xel-hosts-resolution",
     "xel-firewalld-service",
     "xel-enable-network-service"
    ]
   },
   {
    "objective": "rhcsa-aligned:users-groups",
    "name": "Users, groups, password aging and sudo",
    "weight": 8,
    "tasks": 2,
    "pool": [
     "xel-users-supplementary",
     "xel-password-aging",
     "xel-sudo-group-nopasswd",
     "xel-user-uid-expire"
    ]
   },
   {
    "objective": "rhcsa-aligned:security",
    "name": "firewalld, SSH keys and SELinux",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xel-selinux-port-httpd",
     "xel-ssh-key-boolean"
    ]
   }
  ]
 },
 {
  "id": "sim-linux-pro",
  "title": "Linux professional scenario exam simulation",
  "domain": "linux",
  "alignsTo": [
   "linuxplus"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by CompTIA. Linux+ is a trademark of CompTIA. This exam simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical-simulation",
  "simulationNote": "The real exam is mostly multiple choice with a few performance-based items. CloudTrain does not reproduce its question format: it simulates the exam's scenario objectives (including the troubleshooting symptom lists) as short hands-on tasks graded on end state. Recall-only objectives are covered by quizzes outside this simulation.",
  "durationMinutes": 90,
  "passMark": 72,
  "passMarkNote": "Mirrors the published 720 on a 100-900 scale; CloudTrain scores in percent of weighted checks.",
  "taskCount": 20,
  "environment": "per-task",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "local man pages only",
   "notes": "Each task gets its own small environment (Tier A pod or Tier B Kata pod) that starts when the learner opens it; Debian-family and Enterprise Linux images are mixed because the objectives test both firewalld and ufw, NetworkManager and Netplan."
  },
  "retakePolicy": {
   "freeRetakes": 2,
   "cooldownHours": 12,
   "maxAttemptsPer30Days": 4,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "per-objective percentage against the pass mark",
   "per-task pass/fail with learner-safe check messages (no expected values)",
   "time used per task",
   "skill evidence fed to the learner model",
   "recommended labs for objectives below 60%"
  ],
  "blueprint": [
   {
    "objective": "linuxplus:system-management",
    "name": "System management",
    "weight": 23,
    "tasks": 5,
    "pool": [
     "xlp-netplan-address",
     "xlp-lvm-raid-mount-opts",
     "xlp-backup-restore-tar",
     "xlp-fhs-locate-config",
     "xlp-lvm-extend-vg",
     "xlp-module-info",
     "xlp-hardware-report",
     "xlp-raid-status",
     "xlp-sysctl-runtime",
     "xlp-shell-pipeline"
    ]
   },
   {
    "objective": "linuxplus:services-users",
    "name": "Services and user management",
    "weight": 20,
    "tasks": 4,
    "pool": [
     "xlp-user-group-membership",
     "xlp-systemd-enable-mask",
     "xlp-container-network",
     "xlp-pip-venv-tool",
     "xlp-at-job",
     "xlp-dns-dhcp-service",
     "xlp-process-priority",
     "xlp-web-vhost"
    ]
   },
   {
    "objective": "linuxplus:security",
    "name": "Security",
    "weight": 18,
    "tasks": 4,
    "pool": [
     "xlp-ufw-rules",
     "xlp-firewalld-rich-rule",
     "xlp-sudoers-limited",
     "xlp-ssh-disable-root",
     "xlp-luks-open-mount",
     "xlp-setuid-audit",
     "xlp-faillock-policy",
     "xlp-checksum-verify"
    ]
   },
   {
    "objective": "linuxplus:automation-scripting",
    "name": "Automation, orchestration and scripting",
    "weight": 17,
    "tasks": 3,
    "pool": [
     "xlp-script-fix-loop",
     "xlp-git-revert-commit",
     "xlp-python-parse-json",
     "xlp-cloud-init-userdata",
     "xlp-sed-bulk-edit",
     "xlp-script-exit-codes"
    ]
   },
   {
    "objective": "linuxplus:troubleshooting",
    "name": "Troubleshooting",
    "weight": 22,
    "tasks": 4,
    "pool": [
     "xlp-fix-disk-full",
     "xlp-fix-unit-start",
     "xlp-fix-dns-client",
     "xlp-fix-default-route",
     "xlp-fix-high-load",
     "xlp-fix-permission-denied",
     "xlp-fix-oom-service",
     "xlp-fix-time-skew"
    ]
   }
  ]
 },
 {
  "id": "sim-containers-podman",
  "title": "Container developer practical exam simulation",
  "domain": "containers",
  "alignsTo": [
   "ex188-aligned"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Specialist in Containers is a trademark of Red Hat, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 150,
  "passMark": 70,
  "passMarkNote": "The real exam reports a scaled score with a published passing threshold; 70% is a CloudTrain setting for this simulation.",
  "taskCount": 12,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": true,
   "idempotencyRerun": false,
   "partialCredit": "per-task",
   "docsAllowed": "local man pages and offline Podman documentation only; no internet",
   "notes": "One podman-vm:5 host (SELinux enforcing) with a local TLS registry; the grader reboots the VM, then checks end state. Tasks drawn so build tasks feeding later tasks (e.g. media-api image) are seeded if the build task is not drawn."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "per-objective percent against the pass mark",
   "per-task pass/fail with learner-safe messages",
   "which checks failed only after the reboot",
   "time used per task",
   "skill deltas fed to the learner model",
   "recommended Podman-track labs for weak objectives"
  ],
  "blueprint": [
   {
    "objective": "ex188-aligned:build-images",
    "name": "Building images from a Containerfile",
    "weight": 25,
    "tasks": 3,
    "pool": [
     "xct-build-media-containerfile",
     "xct-build-args-env",
     "xct-build-entrypoint-cmd",
     "xct-build-volume-selinux",
     "xct-build-arbitrary-uid",
     "xct-build-multistage-small"
    ]
   },
   {
    "objective": "ex188-aligned:manage-images",
    "name": "Managing images and registries",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xct-manage-registry-push",
     "xct-manage-short-names",
     "xct-manage-image-archive",
     "xct-manage-container-state"
    ]
   },
   {
    "objective": "ex188-aligned:run-containers",
    "name": "Running and inspecting containers",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xct-run-ports-env",
     "xct-run-persistent-db",
     "xct-run-quadlet-service",
     "xct-run-resource-limits",
     "xct-run-rootless-user",
     "xct-run-inspect-report"
    ]
   },
   {
    "objective": "ex188-aligned:multi-container",
    "name": "Multi-container applications",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xct-multi-pod-api-db",
     "xct-multi-secret-password",
     "xct-multi-kube-play",
     "xct-multi-network-dependency"
    ]
   },
   {
    "objective": "ex188-aligned:troubleshoot",
    "name": "Troubleshooting containers",
    "weight": 15,
    "tasks": 2,
    "pool": [
     "xct-trouble-crashloop",
     "xct-trouble-port-conflict",
     "xct-trouble-selinux-mount",
     "xct-trouble-exec-diagnose"
    ]
   }
  ]
 },
 {
  "id": "sim-iac-associate",
  "title": "Infrastructure as code associate exam simulation",
  "domain": "iac",
  "alignsTo": [
   "tf-associate"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and Terraform Associate are trademarks of HashiCorp. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical-simulation",
  "simulationNote": "The real associate exam is multiple choice. CloudTrain simulates its objectives as short hands-on tasks graded on files, state and plan output; the hosted-platform objective is graded through layout-design and run-log reading tasks, with no hosted account.",
  "durationMinutes": 60,
  "passMark": 70,
  "passMarkNote": "The vendor does not publish a pass mark for this exam; 70 percent is a CloudTrain setting.",
  "taskCount": 12,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "offline OpenTofu and provider documentation only; no web access",
   "notes": "OpenTofu CLI by default; tasks are CLI-neutral. Each task has its own directory in one shared workspace pod plus a vcluster."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters"
  },
  "reportIncludes": [
   "per-objective percent against the pass mark",
   "per-task pass/fail with learner-safe check messages",
   "skill deltas fed to the learner model",
   "time used per task",
   "recommended labs for objectives below 70 percent"
  ],
  "blueprint": [
   {
    "objective": "tf-associate:iac-concepts",
    "name": "Infrastructure as code concepts",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xia-declarative-rewrite",
     "xia-predict-plan-actions"
    ]
   },
   {
    "objective": "tf-associate:fundamentals",
    "name": "Providers, installation and the lock file",
    "weight": 10,
    "tasks": 1,
    "pool": [
     "xia-pin-provider-offline",
     "xia-mirror-cli-config"
    ]
   },
   {
    "objective": "tf-associate:core-workflow",
    "name": "Core workflow (init, plan, apply, destroy, fmt, validate)",
    "weight": 12,
    "tasks": 1,
    "pool": [
     "xia-saved-plan-apply",
     "xia-fmt-validate-gate"
    ]
   },
   {
    "objective": "tf-associate:configuration",
    "name": "Resources, variables, outputs, expressions, dependencies and lifecycle",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xia-variable-validation",
     "xia-for-each-namespaces",
     "xia-ignore-operator-annotations",
     "xia-ordering-helm-secret"
    ]
   },
   {
    "objective": "tf-associate:custom-conditions",
    "name": "Validation, pre/postconditions and check blocks",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xia-precondition-label",
     "xia-check-block-endpoint"
    ]
   },
   {
    "objective": "tf-associate:secrets",
    "name": "Sensitive data, ephemeral values and write-only arguments",
    "weight": 7,
    "tasks": 1,
    "pool": [
     "xia-sensitive-redaction",
     "xia-write-only-password"
    ]
   },
   {
    "objective": "tf-associate:modules",
    "name": "Modules",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xia-call-local-module",
     "xia-git-module-pin",
     "xia-module-output-wiring",
     "xia-module-input-contract"
    ]
   },
   {
    "objective": "tf-associate:state",
    "name": "State and backends",
    "weight": 12,
    "tasks": 1,
    "pool": [
     "xia-s3-backend-migrate",
     "xia-state-rename"
    ]
   },
   {
    "objective": "tf-associate:maintain",
    "name": "Import, logging and drift",
    "weight": 6,
    "tasks": 1,
    "pool": [
     "xia-import-namespace",
     "xia-debug-log-file"
    ]
   },
   {
    "objective": "tf-associate:hcp",
    "name": "HCP Terraform workspaces and projects (concepts)",
    "weight": 5,
    "tasks": 1,
    "pool": [
     "xia-workspace-layout-design",
     "xia-run-log-reading"
    ]
   }
  ]
 },
 {
  "id": "sim-iac-advanced",
  "title": "Infrastructure as code advanced lab exam simulation",
  "domain": "iac",
  "alignsTo": [
   "tf-advanced"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by HashiCorp, an IBM Company. Terraform and the Terraform Authoring and Operations certification names are trademarks of HashiCorp. This simulation covers objectives aligned to that exam; passing it confers no certification. Targets are Moto and Kubernetes, not AWS.",
  "format": "practical",
  "durationMinutes": 240,
  "passMark": 70,
  "passMarkNote": "The vendor publishes neither duration nor pass mark for the lab exam; both are CloudTrain settings.",
  "taskCount": 9,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "offline OpenTofu and provider documentation and the offline module registry only; no general web access",
   "notes": "Multi-task scenarios on one pre-provisioned workstation with a vcluster, Moto and the S3 state store; each task graded on configuration, state read from the backend by a read-only grader, live target truth and plan -detailed-exitcode convergence."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 72,
   "maxAttemptsPer30Days": 2,
   "freshDraw": true,
   "notes": "a retake draws different scenarios and new parameters"
  },
  "reportIncludes": [
   "per-objective percent against the pass mark",
   "per-task result split into config, state and live-target layers",
   "skill deltas fed to the learner model",
   "time used per task",
   "recommended labs for weak objectives"
  ],
  "blueprint": [
   {
    "objective": "tf-advanced:lifecycle-import-drift",
    "name": "Resource lifecycle, import and drift reconciliation",
    "weight": 25,
    "tasks": 2,
    "pool": [
     "xiv-import-bucket-fleet",
     "xiv-reconcile-sg-drift",
     "xiv-adopt-workloads-generated",
     "xiv-replace-and-protect"
    ]
   },
   {
    "objective": "tf-advanced:dynamic-config",
    "name": "Dynamic configuration",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xiv-subnets-from-map",
     "xiv-dynamic-ingress-rules",
     "xiv-conditional-env-resources",
     "xiv-templated-configmaps"
    ]
   },
   {
    "objective": "tf-advanced:collaboration",
    "name": "Collaborative workflows and cross-workspace data",
    "weight": 15,
    "tasks": 1,
    "pool": [
     "xiv-remote-state-consumer",
     "xiv-cross-stack-outputs"
    ]
   },
   {
    "objective": "tf-advanced:modules",
    "name": "Splitting configuration into modules",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xiv-extract-vpc-module",
     "xiv-module-upgrade-git",
     "xiv-split-workload-module",
     "xiv-module-for-each"
    ]
   },
   {
    "objective": "tf-advanced:providers",
    "name": "Provider aliasing, upgrades, authentication and troubleshooting",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xiv-provider-alias-regions",
     "xiv-provider-major-upgrade",
     "xiv-fix-provider-auth",
     "xiv-provider-endpoints"
    ]
   }
  ]
 },
 {
  "id": "sim-el-automation",
  "title": "Enterprise Linux automation practical exam simulation",
  "domain": "automation",
  "alignsTo": [
   "ex294-aligned"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by Red Hat, Inc. Red Hat Certified Engineer (RHCE) is a trademark of Red Hat, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical",
  "durationMinutes": 240,
  "passMark": 70,
  "passMarkNote": "Red Hat publishes a 210/300 passing score for its practical exams; 70 percent here is a CloudTrain setting chosen to match, not an official mark.",
  "taskCount": 15,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": true,
   "idempotencyRerun": true,
   "partialCredit": "per-check",
   "docsAllowed": "local man pages, ansible-doc and navigator doc, and the offline product documentation on the control node only",
   "notes": "One control node (ansible-ctl) plus four fresh el-vm:10 managed nodes shared by every task. Grading runs in order: end-state checks over SSH, then each saved playbook under /home/devops/ansible is re-run and must report changed=0 and no failures, then every managed node is rebooted and the end-state checks run again. Only state that survives the reboot scores; playbook text is never graded."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks from each pool and new parameters (user names, sizes, ports, paths)"
  },
  "reportIncludes": [
   "per-objective percent against the pass mark",
   "per-task pass/fail with learner-safe check messages",
   "which checks failed only after the reboot or only on the idempotency re-run",
   "time used per task (from terminal activity)",
   "skill deltas fed to the learner model",
   "recommended labs for each objective below 70 percent"
  ],
  "blueprint": [
   {
    "objective": "ex294-aligned:rhcsa-baseline",
    "name": "System administrator baseline tasks",
    "weight": 5,
    "tasks": 1,
    "pool": [
     "xan-baseline-control-user",
     "xan-baseline-script-output"
    ]
   },
   {
    "objective": "ex294-aligned:core-components",
    "name": "Core components (inventories, modules, variables, facts, loops, conditionals, handlers)",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xan-core-adhoc-repos",
     "xan-core-loop-groups-users",
     "xan-core-facts-hwreport",
     "xan-core-handler-web"
    ]
   },
   {
    "objective": "ex294-aligned:config-inventory",
    "name": "Configuration files and static inventories",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xan-inventory-groups-cfg",
     "xan-inventory-connection-overrides"
    ]
   },
   {
    "objective": "ex294-aligned:managed-nodes",
    "name": "Managed node setup, keys and privilege escalation",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xan-nodes-bootstrap-keys",
     "xan-nodes-become-defaults"
    ]
   },
   {
    "objective": "ex294-aligned:run-content",
    "name": "Running content with navigator and ansible-playbook",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xan-run-navigator-artifact",
     "xan-run-limit-tags"
    ]
   },
   {
    "objective": "ex294-aligned:git-devworkflow",
    "name": "Git, editor and development container workflow",
    "weight": 7,
    "tasks": 1,
    "pool": [
     "xan-git-push-project",
     "xan-git-branch-fix-run"
    ]
   },
   {
    "objective": "ex294-aligned:plays-errors",
    "name": "Plays, registered results and error handling",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xan-errors-block-rescue-file",
     "xan-errors-failed-when-check",
     "xan-errors-register-branch",
     "xan-errors-wait-service"
    ]
   },
   {
    "objective": "ex294-aligned:roles-collections",
    "name": "Roles and collections",
    "weight": 12,
    "tasks": 2,
    "pool": [
     "xan-roles-requirements",
     "xan-roles-author-web",
     "xan-roles-galaxy-role-use",
     "xan-roles-argument-spec"
    ]
   },
   {
    "objective": "ex294-aligned:automate-system-tasks",
    "name": "Automating system administration tasks with modules",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xan-sys-lvm-volumes",
     "xan-sys-partition-mount",
     "xan-sys-vault-users",
     "xan-sys-cron-at",
     "xan-sys-firewalld-selinux-web",
     "xan-sys-boot-target-sysctl",
     "xan-sys-archive-fetch",
     "xan-sys-packages-groups"
    ]
   },
   {
    "objective": "ex294-aligned:templates-vault",
    "name": "Jinja2 templates and Vault",
    "weight": 8,
    "tasks": 1,
    "pool": [
     "xan-tpl-hosts-file",
     "xan-tpl-vault-rekey"
    ]
   }
  ]
 },
 {
  "id": "sim-net-associate",
  "title": "Associate network engineer practical exam simulation",
  "domain": "networking",
  "alignsTo": [
   "ccna"
  ],
  "disclaimer": "CloudTrain is not affiliated with or endorsed by Cisco Systems, Inc. CCNA is a trademark of Cisco Systems, Inc. This simulation covers objectives aligned to that exam; passing it confers no certification.",
  "format": "practical-simulation",
  "simulationNote": "The real exam is mainly multiple choice with some simulation items on vendor CLI. CloudTrain simulates its practical objectives on open network stacks (FRR, Linux bridges and hosts, SR Linux) and grades end state, not commands. Wireless, port-security and DHCP-snooping objectives cannot be reproduced authentically and are covered by quizzes, not by this practical.",
  "durationMinutes": 120,
  "passMark": 80,
  "passMarkNote": "The vendor does not publish a pass mark; 80 percent is a CloudTrain setting to be calibrated with pilot cohorts.",
  "taskCount": 15,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": false,
   "idempotencyRerun": false,
   "partialCredit": "per-check",
   "docsAllowed": "local man pages, FRR and SR Linux offline documentation only",
   "notes": "One shared district topology for all tasks; tasks touch disjoint devices or VLANs so the drawn set never conflicts. Failover checks (floating static, VRRP, LACP) are run by the grader by shutting links after the timer ends."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 24,
   "maxAttemptsPer30Days": 3,
   "freshDraw": true,
   "notes": "a retake draws different tasks and new parameters (addresses, VLAN ids, router names)"
  },
  "reportIncludes": [
   "per-objective percent against the pass mark",
   "per-task pass/fail with learner-safe check messages",
   "skill deltas fed to the learner model",
   "time used per task",
   "recommended labs for each objective below 70 percent",
   "reminder that wireless and port-security objectives are assessed by quiz, not here"
  ],
  "blueprint": [
   {
    "objective": "ccna:network-fundamentals",
    "name": "Network fundamentals",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xnt-subnet-admin-block",
     "xnt-ipv6-office-slaac",
     "xnt-fix-host-gateway",
     "xnt-capture-dns-transport",
     "xnt-neighbour-link-local",
     "xnt-summary-route"
    ]
   },
   {
    "objective": "ccna:network-access",
    "name": "Network access",
    "weight": 20,
    "tasks": 3,
    "pool": [
     "xnt-vlan-guest-ports",
     "xnt-trunk-allowed-vlans",
     "xnt-native-vlan-repair",
     "xnt-rstp-root-choice",
     "xnt-lacp-server-bond",
     "xnt-inter-vlan-annex"
    ]
   },
   {
    "objective": "ccna:ip-connectivity",
    "name": "IP connectivity",
    "weight": 25,
    "tasks": 4,
    "pool": [
     "xnt-static-campus-reachability",
     "xnt-floating-backup-route",
     "xnt-ipv6-default-route",
     "xnt-ospf-join-router",
     "xnt-ospf-dr-election",
     "xnt-ospf-adjacency-repair",
     "xnt-vrrp-lab-gateway",
     "xnt-route-preference-report"
    ]
   },
   {
    "objective": "ccna:ip-services",
    "name": "IP services",
    "weight": 10,
    "tasks": 2,
    "pool": [
     "xnt-dhcp-pool-reservation",
     "xnt-dhcp-relay-annex",
     "xnt-pat-student-vlan",
     "xnt-ntp-syslog-client"
    ]
   },
   {
    "objective": "ccna:security-fundamentals",
    "name": "Security fundamentals",
    "weight": 15,
    "tasks": 2,
    "pool": [
     "xnt-acl-printer-subnet",
     "xnt-mgmt-ssh-only",
     "xnt-wireguard-annex",
     "xnt-snmpv3-only"
    ]
   },
   {
    "objective": "ccna:automation-programmability",
    "name": "Automation and programmability",
    "weight": 10,
    "tasks": 1,
    "pool": [
     "xnt-api-interface-desc",
     "xnt-render-config-from-yaml"
    ]
   }
  ]
 },
 {
  "id": "sim-platform-engineer",
  "title": "Platform engineer practical capstone",
  "domain": "cross-domain",
  "alignsTo": [
   "ct-platform"
  ],
  "disclaimer": "CloudTrain internal assessment. It is not aligned to, affiliated with or endorsed by any certifying body and confers no external certification; a pass grants the CloudTrain platform engineer badge.",
  "format": "practical",
  "description": "CloudTrain's internal capstone. One shared Quillmoor Logistics estate (build VMs, a kubeadm cluster, a vcluster tenant, an FRR edge and a lab registry) where the candidate takes the harbour-tracking service from host baseline to a hardened, routed, autoscaled deployment and then handles an injected incident. Tasks build on each other's environment but are graded independently, so an early miss does not zero later tasks.",
  "durationMinutes": 240,
  "passMark": 70,
  "passMarkNote": "CloudTrain setting; calibrate after the pilot cohort.",
  "taskCount": 10,
  "environment": "shared",
  "rules": {
   "timer": "single",
   "anyOrder": true,
   "flagForReview": true,
   "rebootBeforeGrade": true,
   "idempotencyRerun": true,
   "partialCredit": "per-check",
   "docsAllowed": "offline docs for every tool in the estate; no internet",
   "notes": "VM tasks are re-checked after a reboot of the affected VMs; Ansible tasks are also re-run once and must report no changes."
  },
  "retakePolicy": {
   "freeRetakes": 1,
   "cooldownHours": 72,
   "maxAttemptsPer30Days": 2,
   "freshDraw": true,
   "notes": "Prerequisite: completion of at least three domain paths. A retake draws a different task per objective where the pool allows and new parameters for all."
  },
  "reportIncludes": [
   "percent per objective against the pass mark",
   "per-task pass/fail with learner-safe check messages",
   "skill evidence fed to the learner model",
   "time spent per task",
   "recommended labs for each objective below 70 percent"
  ],
  "blueprint": [
   {
    "objective": "ct-platform:linux-foundation",
    "name": "Linux host operations",
    "weight": 10,
    "tasks": 1,
    "pool": [
     "xpe-host-baseline-service",
     "xpe-host-disk-and-mount"
    ]
   },
   {
    "objective": "ct-platform:containers-delivery",
    "name": "Container build and delivery",
    "weight": 15,
    "tasks": 2,
    "pool": [
     "xpe-image-build-push",
     "xpe-image-sign-verify",
     "xpe-compose-local-stack",
     "xpe-image-slim-fix"
    ]
   },
   {
    "objective": "ct-platform:iac-provisioning",
    "name": "Infrastructure provisioning as code",
    "weight": 15,
    "tasks": 1,
    "pool": [
     "xpe-tofu-namespace-baseline",
     "xpe-tofu-import-drift"
    ]
   },
   {
    "objective": "ct-platform:config-automation",
    "name": "Configuration automation",
    "weight": 15,
    "tasks": 1,
    "pool": [
     "xpe-ansible-node-agents",
     "xpe-ansible-ssh-hardening"
    ]
   },
   {
    "objective": "ct-platform:kubernetes-operations",
    "name": "Kubernetes operations",
    "weight": 20,
    "tasks": 2,
    "pool": [
     "xpe-k8s-deploy-tracking",
     "xpe-k8s-ingress-route",
     "xpe-worker-notready-recovery",
     "xpe-k8s-autoscale-tracking"
    ]
   },
   {
    "objective": "ct-platform:networking-connectivity",
    "name": "Network connectivity",
    "weight": 10,
    "tasks": 1,
    "pool": [
     "xpe-net-depot-route",
     "xpe-net-edge-nat"
    ]
   },
   {
    "objective": "ct-platform:security-hardening",
    "name": "Security hardening",
    "weight": 10,
    "tasks": 1,
    "pool": [
     "xpe-sec-restricted-namespace",
     "xpe-sec-least-privilege-ci"
    ]
   },
   {
    "objective": "ct-platform:incident-response",
    "name": "Incident response",
    "weight": 5,
    "tasks": 1,
    "pool": [
     "xpe-incident-tracking-outage",
     "xpe-incident-disk-pressure"
    ]
   }
  ]
 }
];

export const fixtureTasks: Record<string, FixtureTask> = {
 "xka-pv-claim-mount": {
  "title": "Bind a pre-made volume to a reporting Pod",
  "oneLine": "In qm-archive, claim the existing 3Gi archive volume with a PVC in namespace audit-reports and mount it read-only at /data in a new Pod.",
  "minutes": 7,
  "skills": [
   "k8s.storage.claims",
   "k8s.storage.access-modes"
  ],
  "difficulty": "medium"
 },
 "xka-default-storageclass": {
  "title": "Change the default StorageClass",
  "oneLine": "Make the fast-local StorageClass the only default on qm-yard and create a 1Gi PVC that binds through it without naming a class.",
  "minutes": 6,
  "skills": [
   "k8s.storage.storage-classes"
  ],
  "difficulty": "easy"
 },
 "xka-retain-reclaim": {
  "title": "Keep a released volume's data",
  "oneLine": "Set the ledger-history PV to Retain before its claim is deleted, delete the claim, and make the Released PV Available again for a new claim.",
  "minutes": 8,
  "skills": [
   "k8s.storage.reclaim-policy"
  ],
  "difficulty": "medium"
 },
 "xka-expand-claim": {
  "title": "Grow a claim in place",
  "oneLine": "Expand the manifest-cache PVC in qm-fleet from 1Gi to 3Gi on its expandable StorageClass and record the new capacity reported in the claim's status.",
  "minutes": 6,
  "skills": [
   "k8s.storage.claims",
   "k8s.storage.capacity-units"
  ],
  "difficulty": "easy"
 },
 "xka-kubelet-stopped": {
  "title": "Return a NotReady node to service",
  "oneLine": "dispatch-wk-1 is NotReady; repair its kubelet so the node is Ready and stays Ready after a kubelet restart.",
  "minutes": 10,
  "skills": [
   "k8s.troubleshooting.nodes",
   "k8s.cluster.kubelet"
  ],
  "difficulty": "medium"
 },
 "xka-controller-manager-flag": {
  "title": "Repair the controller manager",
  "oneLine": "Deployments on qm-capacity create no Pods; fix the broken controller-manager static Pod so the pending ReplicaSets scale up.",
  "minutes": 12,
  "skills": [
   "k8s.troubleshooting.control-plane",
   "k8s.cluster.container-runtime"
  ],
  "difficulty": "hard"
 },
 "xka-top-cpu-pod": {
  "title": "Report the busiest Pod by CPU",
  "oneLine": "Write the name of the Pod using the most CPU among those labelled tier=sorting across all namespaces of qm-capacity to the given file.",
  "minutes": 5,
  "skills": [
   "k8s.troubleshooting.resource-usage"
  ],
  "difficulty": "easy"
 },
 "xka-previous-logs-error": {
  "title": "Save the crash reason of a restarting container",
  "oneLine": "Write the lines containing ERROR from the previous instance of the crashing manifest-parser container to the given file.",
  "minutes": 5,
  "skills": [
   "k8s.troubleshooting.logs"
  ],
  "difficulty": "easy"
 },
 "xka-service-selector-fix": {
  "title": "Restore traffic to a Service with no backends",
  "oneLine": "The berth-status Service has no EndpointSlice entries; fix it without touching the Deployment so the probe Pod gets HTTP 200.",
  "minutes": 7,
  "skills": [
   "k8s.troubleshooting.networking",
   "k8s.networking.endpoints"
  ],
  "difficulty": "medium"
 },
 "xka-coredns-down": {
  "title": "Fix cluster DNS",
  "oneLine": "Name lookups fail in every qm-tracking Pod; repair CoreDNS so the probe Pod resolves the tracking Service again.",
  "minutes": 10,
  "skills": [
   "k8s.troubleshooting.networking",
   "k8s.networking.coredns-config"
  ],
  "difficulty": "hard"
 },
 "xka-tainted-node-count": {
  "title": "Count nodes that accept new Pods",
  "oneLine": "Write the number of qm-fleet nodes that are Ready and untainted for NoSchedule to the given file.",
  "minutes": 4,
  "skills": [
   "k8s.scheduling.node-status",
   "k8s.scheduling.taints-tolerations"
  ],
  "difficulty": "easy"
 },
 "xka-crictl-container-id": {
  "title": "Find a container on its node with crictl",
  "oneLine": "On yard-wk-1, find the runtime ID and image of the gate-scanner container with crictl and write them to the given file on that node.",
  "minutes": 6,
  "skills": [
   "k8s.cluster.container-runtime"
  ],
  "difficulty": "medium"
 },
 "xka-events-failing-pod": {
  "title": "Get a stuck Pod running",
  "oneLine": "The customs-sync Pod is stuck in ContainerCreating; use its events to find and create the missing ConfigMap so it reaches Running.",
  "minutes": 6,
  "skills": [
   "k8s.troubleshooting.events",
   "k8s.workloads.config"
  ],
  "difficulty": "easy"
 },
 "xka-apiserver-etcd-endpoint": {
  "title": "Reconnect the API server to etcd",
  "oneLine": "The qm-ledger API server crash-loops after a change; fix its etcd connection settings so kubectl works again.",
  "minutes": 12,
  "skills": [
   "k8s.troubleshooting.control-plane",
   "k8s.troubleshooting.logs"
  ],
  "difficulty": "hard"
 },
 "xka-hpa-memory": {
  "title": "Autoscale a Deployment",
  "oneLine": "Create an HPA for the label-queue Deployment that keeps 2-6 replicas at 70 % CPU with a 120 s scale-down stabilisation window.",
  "minutes": 7,
  "skills": [
   "k8s.workloads.autoscaling"
  ],
  "difficulty": "medium"
 },
 "xka-rollout-undo": {
  "title": "Undo a broken rollout",
  "oneLine": "Roll the ferry-schedule Deployment back to its previous revision and scale it to 4 ready replicas.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.rollouts",
   "k8s.workloads.scaling"
  ],
  "difficulty": "easy"
 },
 "xka-secret-env-volume": {
  "title": "Wire a Secret into a Deployment",
  "oneLine": "Create the customs-api-key Secret and expose it to the clearance Deployment as env API_KEY and as a file under /run/keys.",
  "minutes": 6,
  "skills": [
   "k8s.workloads.config"
  ],
  "difficulty": "easy"
 },
 "xka-required-affinity": {
  "title": "Constrain placement with node affinity",
  "oneLine": "Make the reefer-monitor Deployment run only on nodes labelled zone=cold and preferably on rack=a, with all replicas Running.",
  "minutes": 7,
  "skills": [
   "k8s.scheduling.node-affinity"
  ],
  "difficulty": "medium"
 },
 "xka-toleration-control-plane": {
  "title": "Run a Pod on the control plane",
  "oneLine": "Run a Pod named cp-inspector on qm-fleet's control-plane node using a toleration and nodeSelector, without removing the node's taint.",
  "minutes": 5,
  "skills": [
   "k8s.scheduling.taints-tolerations",
   "k8s.scheduling.node-selector"
  ],
  "difficulty": "easy"
 },
 "xka-sidecar-shared-log": {
  "title": "Add a log sidecar to a Deployment",
  "oneLine": "Add a native sidecar to the gate-log Deployment that streams /var/log/gate/access.log from a shared emptyDir to its stdout.",
  "minutes": 8,
  "skills": [
   "k8s.workloads.native-sidecars",
   "k8s.storage.ephemeral-volumes"
  ],
  "difficulty": "medium"
 },
 "xka-etcd-snapshot-save": {
  "title": "Snapshot a cluster's etcd",
  "oneLine": "Save a verified snapshot of qm-yard's stacked etcd to /srv/backup on yard-cp-1 using the cluster's etcd certificates.",
  "minutes": 8,
  "skills": [
   "k8s.cluster.etcd-snapshot",
   "k8s.cluster.etcd-tls"
  ],
  "difficulty": "medium"
 },
 "xka-worker-join": {
  "title": "Join a prepared worker",
  "oneLine": "Join capacity-wk-3 to qm-capacity with a fresh kubeadm token so it reports Ready.",
  "minutes": 10,
  "skills": [
   "k8s.cluster.kubeadm-install"
  ],
  "difficulty": "medium"
 },
 "xka-node-upgrade-minor": {
  "title": "Upgrade a worker to the next minor",
  "oneLine": "Upgrade dispatch-wk-1's kubeadm and kubelet to v1.37.1 from the offline mirror after draining it, and uncordon it.",
  "minutes": 15,
  "skills": [
   "k8s.cluster.kubeadm-upgrade",
   "k8s.cluster.kubelet"
  ],
  "difficulty": "hard"
 },
 "xka-clusterrole-binding": {
  "title": "Grant a ServiceAccount cluster-wide read on nodes",
  "oneLine": "Create a ServiceAccount fleet-auditor that can list and watch nodes and PersistentVolumes cluster-wide and nothing else.",
  "minutes": 7,
  "skills": [
   "k8s.rbac.clusterroles",
   "k8s.rbac.binding-scope"
  ],
  "difficulty": "medium"
 },
 "xka-helm-install-values": {
  "title": "Install a chart with a values override",
  "oneLine": "Install the gate-metrics chart from the local repo as release gm in namespace monitoring with service.type NodePort set by values.",
  "minutes": 6,
  "skills": [
   "k8s.cluster.packaging"
  ],
  "difficulty": "easy"
 },
 "xka-kustomize-apply": {
  "title": "Apply a Kustomize overlay",
  "oneLine": "Add a patch to the provided production overlay that sets 5 replicas and a prod label, and apply it with kubectl apply -k.",
  "minutes": 6,
  "skills": [
   "k8s.cluster.kustomize"
  ],
  "difficulty": "easy"
 },
 "xka-crd-custom-resource": {
  "title": "Create a custom resource for an installed operator",
  "oneLine": "List the fields of the installed BerthAllocation CRD and create one for berth 7 that the operator marks Ready.",
  "minutes": 7,
  "skills": [
   "k8s.cluster.extensions"
  ],
  "difficulty": "medium"
 },
 "xka-csr-user-access": {
  "title": "Onboard a user with a certificate",
  "oneLine": "Approve the pending CSR for user ops-mara and bind her to view Pods in namespace dock-scheduling only.",
  "minutes": 8,
  "skills": [
   "k8s.rbac.user-certificates"
  ],
  "difficulty": "medium"
 },
 "xka-netpol-egress-db": {
  "title": "Restrict egress to one database",
  "oneLine": "Allow Pods labelled app=invoicing to send traffic only to the ledger-db Pods on 5432 and to DNS, and nowhere else.",
  "minutes": 8,
  "skills": [
   "k8s.networking.netpol-selectors",
   "k8s.networking.netpol-ports"
  ],
  "difficulty": "medium"
 },
 "xka-nodeport-fixed": {
  "title": "Expose a Deployment on a fixed node port",
  "oneLine": "Expose the gate-kiosk Deployment on node port 30880 so the workstation reaches it on every qm-tracking node.",
  "minutes": 5,
  "skills": [
   "k8s.networking.nodeport"
  ],
  "difficulty": "easy"
 },
 "xka-ingress-host-rule": {
  "title": "Publish an app through an Ingress host rule",
  "oneLine": "Route ferry.quillmoor.example/ to the ferry-board Service on port 8080 with an Ingress using the cluster's IngressClass.",
  "minutes": 6,
  "skills": [
   "k8s.networking.ingress-gateway"
  ],
  "difficulty": "easy"
 },
 "xka-httproute-split": {
  "title": "Migrate an Ingress to Gateway API",
  "oneLine": "Replace the berth-portal Ingress with a Gateway listener and HTTPRoute that serve the same host and paths, then delete the Ingress.",
  "minutes": 12,
  "skills": [
   "k8s.networking.gateway-api"
  ],
  "difficulty": "hard"
 },
 "xka-dns-lookup-record": {
  "title": "Record Service and Pod DNS names",
  "oneLine": "Write the cluster DNS answer for the tariff Service and for a given Pod IP in namespace customs to the given files.",
  "minutes": 5,
  "skills": [
   "k8s.networking.dns"
  ],
  "difficulty": "easy"
 },
 "xka-loadbalancer-address": {
  "title": "Expose with a LoadBalancer and record the address",
  "oneLine": "Expose the quote-engine Deployment with a LoadBalancer Service on port 80 and write its external address to the given file.",
  "minutes": 5,
  "skills": [
   "k8s.networking.loadbalancer"
  ],
  "difficulty": "easy"
 },
 "xkd-cronjob-cleanup": {
  "title": "Schedule a cleanup job",
  "oneLine": "Create a CronJob that runs the purge-tmp command every 15 minutes, forbids concurrent runs and keeps 2 finished Jobs.",
  "minutes": 6,
  "skills": [
   "k8s.workloads.jobs"
  ],
  "difficulty": "easy"
 },
 "xkd-job-completions": {
  "title": "Run a Job to a fixed number of completions",
  "oneLine": "Run a Job named rate-import that completes 6 times with 2 Pods in parallel and a backoff limit of 3.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.jobs"
  ],
  "difficulty": "easy"
 },
 "xkd-init-container-seed": {
  "title": "Seed data with an init container",
  "oneLine": "Add an init container to the timetable Pod that writes the seed file into a shared emptyDir before the web container starts serving it.",
  "minutes": 7,
  "skills": [
   "k8s.workloads.native-sidecars",
   "k8s.storage.ephemeral-volumes"
  ],
  "difficulty": "medium"
 },
 "xkd-build-tag-image": {
  "title": "Build and save an image",
  "oneLine": "Build the provided Containerfile as quote-api:2.1, change its exposed port to 9090, and save it as an OCI archive at the given path.",
  "minutes": 8,
  "skills": [
   "k8s.delivery.image-build"
  ],
  "difficulty": "medium"
 },
 "xkd-pvc-mount-pod": {
  "title": "Persist a Pod's data on a claim",
  "oneLine": "Create a 500Mi ReadWriteOnce PVC and mount it at /var/lib/notes in the notes-api Pod so the file it writes survives Pod recreation.",
  "minutes": 6,
  "skills": [
   "k8s.storage.claims"
  ],
  "difficulty": "easy"
 },
 "xkd-workload-kind-choice": {
  "title": "Pick the right workload resource",
  "oneLine": "Convert the node-cache Deployment into a DaemonSet with the same Pod template so exactly one Pod runs per worker.",
  "minutes": 7,
  "skills": [
   "k8s.workloads.daemonsets"
  ],
  "difficulty": "medium"
 },
 "xkd-canary-share": {
  "title": "Add a canary behind an existing Service",
  "oneLine": "Add a quote-engine-canary Deployment so about 20 % of the 10 Pods behind the quote Service run the new image.",
  "minutes": 8,
  "skills": [
   "k8s.delivery.deployment-strategies"
  ],
  "difficulty": "medium"
 },
 "xkd-bluegreen-switch": {
  "title": "Switch a Service to the green release",
  "oneLine": "Point the booking Service at the green Deployment's Pods and scale blue to zero once green is fully ready.",
  "minutes": 6,
  "skills": [
   "k8s.delivery.deployment-strategies"
  ],
  "difficulty": "easy"
 },
 "xkd-rolling-strategy": {
  "title": "Set a rolling update strategy and roll out",
  "oneLine": "Set maxSurge 2 and maxUnavailable 0 on the manifest-api Deployment and roll it out to image tag 3.4.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.rollouts"
  ],
  "difficulty": "easy"
 },
 "xkd-helm-upgrade-rollback": {
  "title": "Upgrade and roll back a Helm release",
  "oneLine": "Upgrade release track-ui to chart version 1.3.0, then roll it back to revision 1 and record the final revision number.",
  "minutes": 7,
  "skills": [
   "k8s.cluster.packaging"
  ],
  "difficulty": "medium"
 },
 "xkd-kustomize-image-tag": {
  "title": "Set an image tag through Kustomize",
  "oneLine": "Use the staging overlay's images field to set the parcel-api tag to 2.7 and apply the overlay.",
  "minutes": 5,
  "skills": [
   "k8s.cluster.kustomize"
  ],
  "difficulty": "easy"
 },
 "xkd-scale-and-pause": {
  "title": "Pause a rollout to batch changes",
  "oneLine": "Pause the dock-board rollout, change its image and memory limit, then resume so only one new ReplicaSet is created.",
  "minutes": 7,
  "skills": [
   "k8s.workloads.rollouts"
  ],
  "difficulty": "medium"
 },
 "xkd-readiness-http": {
  "title": "Add an HTTP readiness probe",
  "oneLine": "Add a readiness probe on /healthz port 8080 with a 5 s period to the carrier-api Deployment.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.probes"
  ],
  "difficulty": "easy"
 },
 "xkd-liveness-exec-fix": {
  "title": "Fix a liveness probe that kills a healthy app",
  "oneLine": "The ledger-sync Pod restarts constantly; correct its liveness probe so it stays Running with zero new restarts.",
  "minutes": 7,
  "skills": [
   "k8s.workloads.probes",
   "k8s.troubleshooting.events"
  ],
  "difficulty": "medium"
 },
 "xkd-deprecated-manifest": {
  "title": "Update a manifest to a served API version",
  "oneLine": "Fix the provided manifest that uses a removed API version so it applies cleanly and creates the resource.",
  "minutes": 6,
  "skills": [
   "k8s.delivery.api-deprecations"
  ],
  "difficulty": "medium"
 },
 "xkd-logs-container-select": {
  "title": "Save one container's logs",
  "oneLine": "Write the logs of the uploader container of the label-batch Pod to the given file.",
  "minutes": 4,
  "skills": [
   "k8s.troubleshooting.logs"
  ],
  "difficulty": "easy"
 },
 "xkd-top-memory-report": {
  "title": "Report the Pod using most memory",
  "oneLine": "Write the name of the Pod using the most memory in namespace parcel-sorting to the given file.",
  "minutes": 4,
  "skills": [
   "k8s.troubleshooting.resource-usage"
  ],
  "difficulty": "easy"
 },
 "xkd-debug-distroless": {
  "title": "Inspect a shell-less Pod",
  "oneLine": "Use an ephemeral debug container on the rates-engine Pod to read its loaded config and write the value of its region setting to the given file.",
  "minutes": 7,
  "skills": [
   "k8s.troubleshooting.debug-containers"
  ],
  "difficulty": "medium"
 },
 "xkd-configmap-volume": {
  "title": "Mount configuration from a ConfigMap",
  "oneLine": "Create ConfigMap tariff-rules from the given file and mount it at /etc/tariff in the tariff-api Deployment.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.config"
  ],
  "difficulty": "easy"
 },
 "xkd-secret-env-from": {
  "title": "Load all keys of a Secret as environment",
  "oneLine": "Create Secret carrier-creds with two keys and load both into the carrier-sync container with envFrom.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.config"
  ],
  "difficulty": "easy"
 },
 "xkd-security-context-user": {
  "title": "Run a container as a non-root user",
  "oneLine": "Make the invoice-api container run as UID 1500 with privilege escalation disabled and all capabilities dropped except NET_BIND_SERVICE.",
  "minutes": 6,
  "skills": [
   "k8s.security.security-context"
  ],
  "difficulty": "medium"
 },
 "xkd-requests-limits": {
  "title": "Set requests and limits",
  "oneLine": "Give the eta-predictor container requests of 200m CPU and 256Mi memory and limits twice as large.",
  "minutes": 4,
  "skills": [
   "k8s.workloads.resources"
  ],
  "difficulty": "easy"
 },
 "xkd-quota-namespace": {
  "title": "Limit a namespace with a quota",
  "oneLine": "Create a ResourceQuota in namespace pilot-apps allowing at most 6 Pods, 2 CPU of requests and 4Gi of memory limits.",
  "minutes": 5,
  "skills": [
   "k8s.workloads.quotas-limitranges"
  ],
  "difficulty": "easy"
 },
 "xkd-serviceaccount-pod": {
  "title": "Run a Pod under a dedicated ServiceAccount",
  "oneLine": "Create ServiceAccount route-reader and run the route-sync Deployment under it.",
  "minutes": 4,
  "skills": [
   "k8s.rbac.service-accounts"
  ],
  "difficulty": "easy"
 },
 "xkd-role-configmaps": {
  "title": "Grant read access to ConfigMaps",
  "oneLine": "Allow ServiceAccount route-reader to get, list and watch ConfigMaps in its own namespace only.",
  "minutes": 6,
  "skills": [
   "k8s.rbac.roles",
   "k8s.rbac.binding-scope"
  ],
  "difficulty": "medium"
 },
 "xkd-custom-resource-create": {
  "title": "Create a custom resource",
  "oneLine": "Create a DeliveryWindow custom resource named harbour-am with the start and end times given, using the installed CRD.",
  "minutes": 5,
  "skills": [
   "k8s.cluster.extensions"
  ],
  "difficulty": "easy"
 },
 "xkd-clusterip-expose": {
  "title": "Expose a Deployment inside the cluster",
  "oneLine": "Expose the rates-api Deployment as ClusterIP Service rates on port 80 targeting container port 8080.",
  "minutes": 4,
  "skills": [
   "k8s.networking.services"
  ],
  "difficulty": "easy"
 },
 "xkd-netpol-allow-frontend": {
  "title": "Allow one client app with a NetworkPolicy",
  "oneLine": "Allow only Pods labelled role=portal to reach the quote-db Pods on 6379 in namespace pricing.",
  "minutes": 7,
  "skills": [
   "k8s.networking.netpol-selectors",
   "k8s.networking.netpol-ports"
  ],
  "difficulty": "medium"
 },
 "xkd-ingress-path": {
  "title": "Route a path with an Ingress",
  "oneLine": "Route /quotes on shop.quillmoor.example to the quote Service port 80 through an Ingress.",
  "minutes": 5,
  "skills": [
   "k8s.networking.ingress-gateway"
  ],
  "difficulty": "easy"
 },
 "xkd-service-port-fix": {
  "title": "Fix a Service that targets the wrong port",
  "oneLine": "The booking Service connects but gets refused; correct its targetPort so the probe Pod receives HTTP 200.",
  "minutes": 5,
  "skills": [
   "k8s.troubleshooting.networking"
  ],
  "difficulty": "easy"
 },
 "xkd-nodeport-expose": {
  "title": "Expose an app on a node port",
  "oneLine": "Expose the kiosk-ui Deployment as a NodePort Service and write the assigned node port to the given file.",
  "minutes": 5,
  "skills": [
   "k8s.networking.nodeport"
  ],
  "difficulty": "easy"
 },
 "xkd-named-port-service": {
  "title": "Target a named container port",
  "oneLine": "Name container port 8443 of the customs-ui Deployment https and make Service customs-ui target it by name.",
  "minutes": 6,
  "skills": [
   "k8s.networking.named-ports"
  ],
  "difficulty": "medium"
 },
 "xks-default-deny-ns": {
  "title": "Apply a default-deny baseline",
  "oneLine": "Add default-deny ingress and egress policies to namespace billing that still allow DNS lookups.",
  "minutes": 7,
  "skills": [
   "k8s.security.netpol-default-deny"
  ],
  "difficulty": "medium"
 },
 "xks-metadata-egress-block": {
  "title": "Block egress to the node metadata address",
  "oneLine": "Prevent all Pods in namespace partner-apps from reaching 169.254.169.254 while other egress keeps working.",
  "minutes": 7,
  "skills": [
   "k8s.security.node-metadata"
  ],
  "difficulty": "medium"
 },
 "xks-ingress-tls-secret": {
  "title": "Serve an Ingress over TLS",
  "oneLine": "Create a TLS Secret from the given files and make the portal Ingress serve portal.quillmoor.example over HTTPS only.",
  "minutes": 7,
  "skills": [
   "k8s.security.ingress-tls"
  ],
  "difficulty": "medium"
 },
 "xks-cis-kubelet-fix": {
  "title": "Resolve benchmark findings on a node",
  "oneLine": "Fix the two failing kubelet benchmark findings listed in the report on yard-wk-1 so a rescan passes them.",
  "minutes": 10,
  "skills": [
   "k8s.security.cis-benchmark"
  ],
  "difficulty": "hard"
 },
 "xks-rbac-reduce": {
  "title": "Reduce a Role to least privilege",
  "oneLine": "Trim the report-builder Role to exactly get and list on Pods and ConfigMaps, removing every other verb and resource.",
  "minutes": 6,
  "skills": [
   "k8s.security.rbac-least-privilege"
  ],
  "difficulty": "medium"
 },
 "xks-sa-automount": {
  "title": "Stop automounting API tokens",
  "oneLine": "Disable token automounting for the default ServiceAccount in namespace kiosk and for the kiosk-ui Pods.",
  "minutes": 5,
  "skills": [
   "k8s.security.sa-token-hygiene"
  ],
  "difficulty": "easy"
 },
 "xks-apiserver-anonymous": {
  "title": "Disable anonymous API access",
  "oneLine": "Turn off anonymous authentication on the qm-ledger API server and confirm the admin kubeconfig still works.",
  "minutes": 10,
  "skills": [
   "k8s.security.api-server-hardening"
  ],
  "difficulty": "hard"
 },
 "xks-node-restriction": {
  "title": "Enable the NodeRestriction admission plugin",
  "oneLine": "Enable NodeRestriction on the qm-fleet API server so kubelets can only modify their own Node and Pods.",
  "minutes": 8,
  "skills": [
   "k8s.security.api-server-hardening"
  ],
  "difficulty": "medium"
 },
 "xks-apparmor-profile-pod": {
  "title": "Apply an AppArmor profile to a Pod",
  "oneLine": "Load the provided AppArmor profile on fleet-wk-1 and run the scanner Pod there with that profile enforced.",
  "minutes": 8,
  "skills": [
   "k8s.security.seccomp-apparmor"
  ],
  "difficulty": "medium"
 },
 "xks-seccomp-localhost": {
  "title": "Apply a custom seccomp profile",
  "oneLine": "Run the label-render Pod with the Localhost seccomp profile placed under the kubelet's seccomp directory.",
  "minutes": 7,
  "skills": [
   "k8s.security.seccomp-apparmor"
  ],
  "difficulty": "medium"
 },
 "xks-remove-service-port": {
  "title": "Remove an unneeded service from a node",
  "oneLine": "Stop, disable and remove the package behind the unexpected listener on fleet-wk-2 so only expected ports remain open.",
  "minutes": 7,
  "skills": [
   "linux.security.attack-surface"
  ],
  "difficulty": "medium"
 },
 "xks-kubelet-webhook-authz": {
  "title": "Require authorization on the kubelet API",
  "oneLine": "Configure dispatch-wk-1's kubelet for Webhook authentication and authorization with anonymous access off, keeping the node Ready.",
  "minutes": 10,
  "skills": [
   "k8s.security.kubelet-hardening"
  ],
  "difficulty": "hard"
 },
 "xks-pss-restricted": {
  "title": "Enforce restricted Pod Security on a namespace",
  "oneLine": "Enforce the restricted level on namespace partner-apps and fix the partner-sync Deployment so its Pods are admitted.",
  "minutes": 8,
  "skills": [
   "k8s.security.pod-security-admission",
   "k8s.security.security-context"
  ],
  "difficulty": "medium"
 },
 "xks-runtimeclass-move": {
  "title": "Move a workload to a sandboxed runtime",
  "oneLine": "Create RuntimeClass sandboxed for the gVisor handler and run the pdf-convert Deployment with it.",
  "minutes": 7,
  "skills": [
   "k8s.security.sandboxing"
  ],
  "difficulty": "medium"
 },
 "xks-encryption-config": {
  "title": "Encrypt one resource type at rest",
  "oneLine": "Configure an encryption provider for Secrets on the qm-capacity API server and re-write the existing Secrets in namespace billing.",
  "minutes": 12,
  "skills": [
   "k8s.security.secrets"
  ],
  "difficulty": "hard"
 },
 "xks-immutable-secret": {
  "title": "Make a Secret immutable and mount it read-only",
  "oneLine": "Recreate Secret signing-key as immutable and mount it read-only at /run/signing in the signer Pod.",
  "minutes": 5,
  "skills": [
   "k8s.security.secrets"
  ],
  "difficulty": "easy"
 },
 "xks-drop-privileged": {
  "title": "Remove privileged settings from a Deployment",
  "oneLine": "Remove privileged mode and hostPath mounts from the log-collector Deployment while it keeps reading its emptyDir log volume.",
  "minutes": 7,
  "skills": [
   "k8s.security.security-context"
  ],
  "difficulty": "medium"
 },
 "xks-wireguard-cni": {
  "title": "Turn on pod-to-pod encryption",
  "oneLine": "Enable the CNI's WireGuard encryption on qm-customs and write the encryption status reported by the CNI to the given file.",
  "minutes": 10,
  "skills": [
   "k8s.security.mtls"
  ],
  "difficulty": "hard"
 },
 "xks-scan-pick-image": {
  "title": "Remove workloads using images with critical CVEs",
  "oneLine": "Scan the images of the four Deployments in namespace intake and scale to zero those whose images have critical vulnerabilities.",
  "minutes": 8,
  "skills": [
   "k8s.security.supply-chain"
  ],
  "difficulty": "medium"
 },
 "xks-sbom-spdx": {
  "title": "Generate an SBOM for an image",
  "oneLine": "Generate an SPDX JSON SBOM for the dispatch image and save it at the given path.",
  "minutes": 5,
  "skills": [
   "k8s.security.sbom"
  ],
  "difficulty": "easy"
 },
 "xks-registry-vap": {
  "title": "Admit only approved registries",
  "oneLine": "Create a ValidatingAdmissionPolicy and binding that rejects Pods in namespace intake using images outside registry.quillmoor.example.",
  "minutes": 10,
  "skills": [
   "k8s.security.admission-control"
  ],
  "difficulty": "hard"
 },
 "xks-dockerfile-hardening": {
  "title": "Harden a Containerfile",
  "oneLine": "Change the given Containerfile so it uses the pinned minimal base, runs as a non-root user and drops the build tools from the final stage.",
  "minutes": 7,
  "skills": [
   "k8s.security.image-footprint"
  ],
  "difficulty": "medium"
 },
 "xks-manifest-static-fix": {
  "title": "Fix risky settings found by static analysis",
  "oneLine": "Fix the two settings the analyser flags in the given Deployment manifest so a rescan reports no findings, then apply it.",
  "minutes": 7,
  "skills": [
   "k8s.security.static-analysis"
  ],
  "difficulty": "medium"
 },
 "xks-signature-verify": {
  "title": "Verify image signatures before deployment",
  "oneLine": "Verify the signatures of three tagged images with the given public key and deploy only the one that verifies.",
  "minutes": 8,
  "skills": [
   "k8s.security.image-signing"
  ],
  "difficulty": "medium"
 },
 "xks-audit-policy-secrets": {
  "title": "Write and enable an audit policy",
  "oneLine": "Enable audit logging on the qm-ledger API server with a policy that records Secret access at Metadata level and nothing for Events.",
  "minutes": 12,
  "skills": [
   "k8s.security.audit-logging"
  ],
  "difficulty": "hard"
 },
 "xks-runtime-alert-scale": {
  "title": "Act on a runtime detection alert",
  "oneLine": "Find which Pod triggered the runtime alert for unexpected package installs and scale its Deployment to zero.",
  "minutes": 8,
  "skills": [
   "k8s.security.runtime-detection"
  ],
  "difficulty": "medium"
 },
 "xks-detection-rule-output": {
  "title": "Adjust a detection rule's output",
  "oneLine": "Change the provided runtime rule so its alert includes the container name and user, and write one resulting alert line to the given file.",
  "minutes": 8,
  "skills": [
   "k8s.security.runtime-detection"
  ],
  "difficulty": "medium"
 },
 "xks-readonly-rootfs": {
  "title": "Make a container's filesystem read-only",
  "oneLine": "Set a read-only root filesystem on the ticket-printer Deployment and give /tmp an emptyDir so it stays Running.",
  "minutes": 6,
  "skills": [
   "k8s.security.immutability"
  ],
  "difficulty": "easy"
 },
 "xks-audit-log-reader": {
  "title": "Find who read a Secret in the audit log",
  "oneLine": "Search the existing audit log on ledger-cp-1 and write the user that read Secret partner-token to the given file.",
  "minutes": 7,
  "skills": [
   "k8s.security.incident-investigation",
   "k8s.security.audit-logging"
  ],
  "difficulty": "medium"
 },
 "xks-incident-isolate-pod": {
  "title": "Isolate a flagged Pod for investigation",
  "oneLine": "Isolate the Pod named in the incident ticket with a deny-all NetworkPolicy, keep it running for forensics and label it quarantine=true.",
  "minutes": 7,
  "skills": [
   "k8s.security.incident-investigation"
  ],
  "difficulty": "medium"
 },
 "xlf-persist-sysctl-pair": {
  "title": "Persist two kernel parameters on the depot gateway",
  "oneLine": "Set two kernel parameters named in the task on depot-gw now and at boot, leaving the rest of the sysctl configuration untouched.",
  "minutes": 6,
  "skills": [
   "linux.kernel.sysctl"
  ],
  "difficulty": "easy"
 },
 "xlf-repo-install-hold": {
  "title": "Install a held package version from the vendor mirror",
  "oneLine": "Add the vendor apt source with its key, install the exact signalling-agent version requested and hold it.",
  "minutes": 8,
  "skills": [
   "linux.packages.repositories",
   "linux.packages.version-pinning"
  ],
  "difficulty": "medium"
 },
 "xlf-timer-housekeeping": {
  "title": "Schedule a housekeeping script with a timer",
  "oneLine": "Run the cache-purge script every 20 minutes through a systemd timer that catches up after downtime.",
  "minutes": 8,
  "skills": [
   "linux.systemd.timers"
  ],
  "difficulty": "medium"
 },
 "xlf-kill-memory-hog": {
  "title": "Stop the process exhausting memory and prevent its restart",
  "oneLine": "Identify the process consuming the most memory, stop it, and disable the unit that keeps respawning it.",
  "minutes": 6,
  "skills": [
   "linux.processes.management",
   "linux.systemd.units"
  ],
  "difficulty": "easy"
 },
 "xlf-recover-fstab-boot": {
  "title": "Make a host with a bad fstab entry boot cleanly",
  "oneLine": "Fix the fstab entry that drops the EL node into emergency mode so it reaches multi-user and the volume mounts.",
  "minutes": 12,
  "skills": [
   "linux.boot.recovery"
  ],
  "difficulty": "hard"
 },
 "xlf-container-restart-policy": {
  "title": "Run a container that restarts and keeps its data",
  "oneLine": "Run the given image with a published port, a named volume for its data directory and an always-restart policy.",
  "minutes": 8,
  "skills": [
   "linux.internals.podman"
  ],
  "difficulty": "medium"
 },
 "xlf-selinux-enforce-fix": {
  "title": "Switch the EL node to enforcing without breaking its web service",
  "oneLine": "Set SELinux to enforcing persistently on the EL node and fix the file context so its web content is still served.",
  "minutes": 10,
  "skills": [
   "linux.security.selinux-contexts"
  ],
  "difficulty": "hard"
 },
 "xlf-libvirt-autostart": {
  "title": "Make an existing VM start with its host",
  "oneLine": "Configure the defined libvirt guest to autostart, give it the requested memory size and start it.",
  "minutes": 8,
  "skills": [
   "linux.virt.libvirt"
  ],
  "difficulty": "medium"
 },
 "xlf-cron-as-user": {
  "title": "Schedule a report job for a service account",
  "oneLine": "Schedule the given report command for the service account at the requested times, with its output appended to the requested log.",
  "minutes": 6,
  "skills": [
   "linux.processes.scheduled-jobs"
  ],
  "difficulty": "easy"
 },
 "xlf-module-load-options": {
  "title": "Load a kernel module with options at boot",
  "oneLine": "Make the named module load at every boot with the requested option value.",
  "minutes": 6,
  "skills": [
   "linux.kernel.modules"
  ],
  "difficulty": "medium"
 },
 "xlf-static-ip-netplan": {
  "title": "Give the second interface a persistent dual-stack address",
  "oneLine": "Configure the requested IPv4 and IPv6 addresses on the secondary interface persistently.",
  "minutes": 8,
  "skills": [
   "linux.net.persistent-config"
  ],
  "difficulty": "medium"
 },
 "xlf-static-route-persist": {
  "title": "Add a persistent route to the depot network",
  "oneLine": "Route the given depot prefix through the given next hop, persistently.",
  "minutes": 6,
  "skills": [
   "linux.net.persistent-config"
  ],
  "difficulty": "easy"
 },
 "xlf-nat-redirect": {
  "title": "Redirect a public port to a backend",
  "oneLine": "Forward the requested port on the gateway to the backend host and port, with forwarding enabled persistently.",
  "minutes": 10,
  "skills": [
   "linux.net.nat-forwarding"
  ],
  "difficulty": "hard"
 },
 "xlf-firewall-subnet-only": {
  "title": "Allow a service from one subnet only",
  "oneLine": "Permit the requested TCP port only from the given subnet and keep SSH open, persistently.",
  "minutes": 8,
  "skills": [
   "linux.net.firewall"
  ],
  "difficulty": "medium"
 },
 "xlf-sshd-restrict-group": {
  "title": "Restrict SSH logins to one group with keys only",
  "oneLine": "Change sshd so only the given group may log in and only with keys, without locking out the current session.",
  "minutes": 8,
  "skills": [
   "linux.services.sshd"
  ],
  "difficulty": "medium"
 },
 "xlf-nginx-lb-two-backends": {
  "title": "Load-balance two local backends behind nginx",
  "oneLine": "Serve the given hostname on port 80 and balance across the two running backends.",
  "minutes": 10,
  "skills": [
   "linux.services.web-proxy"
  ],
  "difficulty": "medium"
 },
 "xlf-bond-config": {
  "title": "Bond two interfaces in active-backup mode",
  "oneLine": "Create a persistent active-backup bond of the two spare interfaces with the requested address.",
  "minutes": 10,
  "skills": [
   "linux.net.bridges-bonds"
  ],
  "difficulty": "hard"
 },
 "xlf-time-sync-server": {
  "title": "Point the host at the lab time server",
  "oneLine": "Synchronise the host's clock only from the given in-lab time server and set the requested time zone.",
  "minutes": 6,
  "skills": [
   "linux.net.time-sync"
  ],
  "difficulty": "easy"
 },
 "xlf-lvm-new-volume": {
  "title": "Create a mounted logical volume of a given size",
  "oneLine": "Create the requested VG and LV from the spare disks, format and mount it persistently at the given path.",
  "minutes": 10,
  "skills": [
   "linux.storage.lvm",
   "linux.storage.mounts"
  ],
  "difficulty": "medium"
 },
 "xlf-lvm-grow-fs": {
  "title": "Extend a volume and its filesystem online",
  "oneLine": "Grow the given LV to the requested size and its filesystem without unmounting.",
  "minutes": 6,
  "skills": [
   "linux.storage.lvm"
  ],
  "difficulty": "easy"
 },
 "xlf-swap-file": {
  "title": "Add a persistent swap file",
  "oneLine": "Add a swap file of the requested size, active now and after reboot.",
  "minutes": 6,
  "skills": [
   "linux.storage.swap"
  ],
  "difficulty": "easy"
 },
 "xlf-nfs-client-mount": {
  "title": "Mount an NFS export persistently",
  "oneLine": "Mount the given export at the given path with the requested options so it survives reboot.",
  "minutes": 6,
  "skills": [
   "linux.storage.network-mounts"
  ],
  "difficulty": "easy"
 },
 "xlf-autofs-map": {
  "title": "Automount per-user shares on demand",
  "oneLine": "Configure autofs so the given directory mounts each user's share from the file server on access.",
  "minutes": 10,
  "skills": [
   "linux.storage.network-mounts"
  ],
  "difficulty": "hard"
 },
 "xlf-repair-xfs": {
  "title": "Repair and remount a damaged filesystem",
  "oneLine": "Repair the filesystem on the given device and mount it at its usual place.",
  "minutes": 8,
  "skills": [
   "linux.storage.repair"
  ],
  "difficulty": "medium"
 },
 "xlf-raid1-create": {
  "title": "Build a mirrored array from two disks",
  "oneLine": "Create a RAID 1 array from the two spare disks, persist its definition and mount a filesystem on it.",
  "minutes": 10,
  "skills": [
   "linux.storage.raid"
  ],
  "difficulty": "hard"
 },
 "xlf-tmpfs-mount": {
  "title": "Mount a size-limited tmpfs",
  "oneLine": "Mount a tmpfs of the requested size and mode at the given path, persistently.",
  "minutes": 5,
  "skills": [
   "linux.storage.mounts"
  ],
  "difficulty": "easy"
 },
 "xlf-find-and-copy": {
  "title": "Find files by criteria and copy them preserving paths",
  "oneLine": "Copy every file matching the given owner, size and age criteria into the target directory with paths preserved.",
  "minutes": 8,
  "skills": [
   "linux.files.find-locate"
  ],
  "difficulty": "medium"
 },
 "xlf-git-commit-push": {
  "title": "Commit a fix to a branch and push it",
  "oneLine": "Clone the given repository, commit the requested change on a new branch and push it to the server.",
  "minutes": 6,
  "skills": [
   "linux.git.basics"
  ],
  "difficulty": "easy"
 },
 "xlf-cert-self-signed": {
  "title": "Create a key and certificate with given subject fields",
  "oneLine": "Generate a key and a certificate with the requested subject, SANs and validity at the given paths.",
  "minutes": 8,
  "skills": [
   "linux.security.tls-certificates"
  ],
  "difficulty": "medium"
 },
 "xlf-free-disk-space": {
  "title": "Free space on a full filesystem without data loss",
  "oneLine": "Bring the given filesystem below the requested usage without deleting the protected data set.",
  "minutes": 8,
  "skills": [
   "linux.storage.space-analysis"
  ],
  "difficulty": "medium"
 },
 "xlf-service-unit-create": {
  "title": "Create a service for a provided binary",
  "oneLine": "Create and enable a unit that runs the given binary as the given user and restarts it on failure.",
  "minutes": 8,
  "skills": [
   "linux.systemd.unit-authoring"
  ],
  "difficulty": "medium"
 },
 "xlf-archive-compare": {
  "title": "Archive a tree and report the differences from a backup",
  "oneLine": "Create the requested compressed archive and write the list of files that differ from the given backup to a file.",
  "minutes": 6,
  "skills": [
   "linux.files.links-archives",
   "linux.shell.text-processing"
  ],
  "difficulty": "easy"
 },
 "xlf-user-limits": {
  "title": "Limit a user's processes",
  "oneLine": "Apply the requested hard and soft process limits to the given user.",
  "minutes": 5,
  "skills": [
   "linux.users.resource-limits"
  ],
  "difficulty": "easy"
 },
 "xlf-acl-shared-dir": {
  "title": "Grant a second group access with default ACLs",
  "oneLine": "Give the given group read-write access to a directory and every future file in it using ACLs.",
  "minutes": 6,
  "skills": [
   "linux.files.acls"
  ],
  "difficulty": "medium"
 },
 "xlf-skel-profile": {
  "title": "Give new users a default environment",
  "oneLine": "Make every newly created user get the given environment variable and file in their home.",
  "minutes": 5,
  "skills": [
   "linux.shell.env-profiles"
  ],
  "difficulty": "easy"
 },
 "xlf-ldap-user-login": {
  "title": "Allow a directory user to log in",
  "oneLine": "Configure the host so the given directory user can log in with a home directory created automatically.",
  "minutes": 12,
  "skills": [
   "linux.identity.sssd-pam"
  ],
  "difficulty": "hard"
 },
 "xel-grep-redirect-file": {
  "title": "Save matching lines from a file in original order",
  "oneLine": "Write every line of the given file that matches the given pattern, in order, to the target file.",
  "minutes": 5,
  "skills": [
   "linux.shell.text-processing"
  ],
  "difficulty": "easy"
 },
 "xel-find-owner-copy": {
  "title": "Copy all files owned by a user to a directory",
  "oneLine": "Copy every file owned by the given user into the target directory keeping attributes.",
  "minutes": 5,
  "skills": [
   "linux.files.find-locate"
  ],
  "difficulty": "easy"
 },
 "xel-tar-bzip-archive": {
  "title": "Create a compressed archive of a directory",
  "oneLine": "Create the requested compressed tar of the given directory at the given path.",
  "minutes": 5,
  "skills": [
   "linux.files.links-archives"
  ],
  "difficulty": "easy"
 },
 "xel-links-hard-soft": {
  "title": "Create hard and symbolic links as specified",
  "oneLine": "Create the requested hard link and symbolic link so both resolve to the given file.",
  "minutes": 4,
  "skills": [
   "linux.files.links-archives"
  ],
  "difficulty": "easy"
 },
 "xel-permissions-umask": {
  "title": "Set ownership, modes and a user's umask",
  "oneLine": "Set the requested owner, group and mode on the given files and make the given user's default umask persistent.",
  "minutes": 6,
  "skills": [
   "linux.files.permissions"
  ],
  "difficulty": "medium"
 },
 "xel-scp-remote-copy": {
  "title": "Copy files securely between the two nodes",
  "oneLine": "Copy the given directory from node 2 to node 1 over SSH, preserving modes.",
  "minutes": 5,
  "skills": [
   "linux.remote.ssh"
  ],
  "difficulty": "easy"
 },
 "xel-repo-config": {
  "title": "Configure the two local repositories",
  "oneLine": "Configure node 2 to use the given BaseOS and AppStream URLs with GPG checking.",
  "minutes": 6,
  "skills": [
   "linux.packages.repositories"
  ],
  "difficulty": "easy"
 },
 "xel-install-remove-rpm": {
  "title": "Install and remove packages to a target state",
  "oneLine": "Install the requested packages and remove the unwanted one so the package set matches the task.",
  "minutes": 5,
  "skills": [
   "linux.packages.dnf"
  ],
  "difficulty": "easy"
 },
 "xel-flatpak-remote": {
  "title": "Add a Flatpak remote and install an app",
  "oneLine": "Add the given local Flatpak remote system-wide and install the requested application from it.",
  "minutes": 6,
  "skills": [
   "linux.packages.flatpak"
  ],
  "difficulty": "medium"
 },
 "xel-update-single-pkg": {
  "title": "Update one package from a staged repository",
  "oneLine": "Update only the given package to the version in the staged repository, leaving everything else unchanged.",
  "minutes": 6,
  "skills": [
   "linux.packages.dnf"
  ],
  "difficulty": "medium"
 },
 "xel-script-args-loop": {
  "title": "Write a script that processes its arguments",
  "oneLine": "Write the script at the given path that loops over its arguments and prints the requested output, exiting non-zero on no arguments.",
  "minutes": 8,
  "skills": [
   "linux.shell.scripting"
  ],
  "difficulty": "medium"
 },
 "xel-script-find-report": {
  "title": "Write a script that reports files by condition",
  "oneLine": "Write a script that finds files matching the given size and type and writes their names to the requested file, using a conditional on its argument.",
  "minutes": 8,
  "skills": [
   "linux.shell.scripting",
   "linux.files.find-locate"
  ],
  "difficulty": "medium"
 },
 "xel-root-password-reset": {
  "title": "Reset the root password of node 2",
  "oneLine": "Set node 2's unknown root password to the given value through the boot process.",
  "minutes": 10,
  "skills": [
   "linux.boot.recovery"
  ],
  "difficulty": "hard"
 },
 "xel-tuned-profile": {
  "title": "Apply the recommended tuning profile",
  "oneLine": "Set the tuning profile that the tool recommends for node 1, persistently.",
  "minutes": 4,
  "skills": [
   "linux.boot.tuned"
  ],
  "difficulty": "easy"
 },
 "xel-journal-persistent": {
  "title": "Make the journal persistent",
  "oneLine": "Configure the journal on node 1 to persist across reboots.",
  "minutes": 5,
  "skills": [
   "linux.observability.journal-persistence"
  ],
  "difficulty": "easy"
 },
 "xel-nice-process": {
  "title": "Start a job at a given priority",
  "oneLine": "Run the given job at the requested niceness as the given user and keep it running.",
  "minutes": 4,
  "skills": [
   "linux.processes.management"
  ],
  "difficulty": "easy"
 },
 "xel-gpt-partition-lv": {
  "title": "Create a volume group with a given extent size",
  "oneLine": "Create the requested VG with the given extent size and an LV of the requested number of extents.",
  "minutes": 8,
  "skills": [
   "linux.storage.lvm",
   "linux.storage.partitions"
  ],
  "difficulty": "medium"
 },
 "xel-swap-partition": {
  "title": "Add a swap partition without touching existing ones",
  "oneLine": "Add a swap partition of the requested size on the second disk, active at boot, leaving existing swap intact.",
  "minutes": 6,
  "skills": [
   "linux.storage.swap"
  ],
  "difficulty": "medium"
 },
 "xel-mount-by-label": {
  "title": "Mount a new filesystem by label",
  "oneLine": "Create a filesystem with the given label on a new partition and mount it by label at the given path.",
  "minutes": 6,
  "skills": [
   "linux.storage.mounts"
  ],
  "difficulty": "easy"
 },
 "xel-add-pv-extend-vg": {
  "title": "Extend a volume group with a new partition",
  "oneLine": "Add a new partition to the existing volume group without disturbing data on the disk.",
  "minutes": 6,
  "skills": [
   "linux.storage.lvm"
  ],
  "difficulty": "medium"
 },
 "xel-mount-by-uuid": {
  "title": "Mount a logical volume by UUID",
  "oneLine": "Mount the given LV by UUID at the given path with the requested options, persistently.",
  "minutes": 5,
  "skills": [
   "linux.storage.mounts"
  ],
  "difficulty": "easy"
 },
 "xel-remove-lv-safely": {
  "title": "Retire a logical volume cleanly",
  "oneLine": "Unmount and remove the given LV and its fstab entry so the host still boots cleanly.",
  "minutes": 5,
  "skills": [
   "linux.storage.lvm",
   "linux.storage.mounts"
  ],
  "difficulty": "easy"
 },
 "xel-resize-lv-fs": {
  "title": "Resize a logical volume to a size range",
  "oneLine": "Resize the given LV and its filesystem to a size within the requested range without data loss.",
  "minutes": 6,
  "skills": [
   "linux.storage.lvm"
  ],
  "difficulty": "medium"
 },
 "xel-autofs-home": {
  "title": "Automount a remote user's home directory",
  "oneLine": "Configure autofs so the given user's home mounts from the NFS server on login.",
  "minutes": 10,
  "skills": [
   "linux.storage.network-mounts"
  ],
  "difficulty": "hard"
 },
 "xel-vfat-mount": {
  "title": "Create and mount a vfat filesystem",
  "oneLine": "Create a vfat filesystem on the given LV and mount it with the requested owner, persistently.",
  "minutes": 5,
  "skills": [
   "linux.storage.filesystems"
  ],
  "difficulty": "easy"
 },
 "xel-fix-dir-permissions": {
  "title": "Fix a permission problem on a shared directory",
  "oneLine": "Members of the given group cannot write to the shared directory; fix ownership and mode so they can, without opening it to others.",
  "minutes": 5,
  "skills": [
   "linux.files.permissions",
   "linux.files.special-bits"
  ],
  "difficulty": "medium"
 },
 "xel-chrony-client": {
  "title": "Synchronise time with the classroom server",
  "oneLine": "Configure node 1 as a chrony client of the given server only.",
  "minutes": 5,
  "skills": [
   "linux.systemd.time-locale"
  ],
  "difficulty": "easy"
 },
 "xel-default-target": {
  "title": "Set the default boot target",
  "oneLine": "Make node 2 boot into the requested target by default.",
  "minutes": 4,
  "skills": [
   "linux.systemd.targets"
  ],
  "difficulty": "easy"
 },
 "xel-timer-job": {
  "title": "Schedule a job with a systemd timer",
  "oneLine": "Run the given command at the requested calendar time with a systemd timer.",
  "minutes": 8,
  "skills": [
   "linux.systemd.timers"
  ],
  "difficulty": "medium"
 },
 "xel-kernel-arg": {
  "title": "Add a kernel argument for every kernel",
  "oneLine": "Add the requested kernel argument to every installed kernel's command line.",
  "minutes": 6,
  "skills": [
   "linux.boot.grub"
  ],
  "difficulty": "medium"
 },
 "xel-nmcli-static": {
  "title": "Configure a static address, gateway and DNS",
  "oneLine": "Configure node 2's network with the given IPv4 and IPv6 settings and hostname, persistently.",
  "minutes": 8,
  "skills": [
   "linux.net.persistent-config"
  ],
  "difficulty": "medium"
 },
 "xel-hosts-resolution": {
  "title": "Make a short name resolve locally",
  "oneLine": "Make the given short and full names resolve to the given address on both nodes.",
  "minutes": 4,
  "skills": [
   "linux.net.name-resolution"
  ],
  "difficulty": "easy"
 },
 "xel-firewalld-service": {
  "title": "Allow a service through firewalld",
  "oneLine": "Permit the requested service and port permanently in the default zone.",
  "minutes": 5,
  "skills": [
   "linux.net.firewalld"
  ],
  "difficulty": "easy"
 },
 "xel-enable-network-service": {
  "title": "Run a network service at boot",
  "oneLine": "Make the given network service start at boot and listen on its port.",
  "minutes": 5,
  "skills": [
   "linux.systemd.units"
  ],
  "difficulty": "easy"
 },
 "xel-users-supplementary": {
  "title": "Create users with supplementary groups and a nologin account",
  "oneLine": "Create the given users, groups and one account without interactive shell, with the requested passwords.",
  "minutes": 6,
  "skills": [
   "linux.users.accounts"
  ],
  "difficulty": "easy"
 },
 "xel-password-aging": {
  "title": "Apply password aging to a user and defaults",
  "oneLine": "Set the requested maximum password age for the given user and for all new users.",
  "minutes": 5,
  "skills": [
   "linux.users.password-aging"
  ],
  "difficulty": "easy"
 },
 "xel-sudo-group-nopasswd": {
  "title": "Grant a group passwordless sudo",
  "oneLine": "Allow members of the given group to run any command via sudo without a password.",
  "minutes": 5,
  "skills": [
   "linux.users.sudo"
  ],
  "difficulty": "easy"
 },
 "xel-user-uid-expire": {
  "title": "Create a user with fixed UID and expiry",
  "oneLine": "Create the given user with the requested UID and account expiry date.",
  "minutes": 4,
  "skills": [
   "linux.users.accounts"
  ],
  "difficulty": "easy"
 },
 "xel-selinux-port-httpd": {
  "title": "Serve web content on a non-standard port under SELinux",
  "oneLine": "Make the web server serve the given directory on the given port with SELinux enforcing, persistently.",
  "minutes": 10,
  "skills": [
   "linux.security.selinux-contexts",
   "linux.net.firewalld"
  ],
  "difficulty": "hard"
 },
 "xel-ssh-key-boolean": {
  "title": "Set up key login and a persistent SELinux boolean",
  "oneLine": "Enable key-based login for the given user from node 1 to node 2 and set the requested SELinux boolean persistently.",
  "minutes": 8,
  "skills": [
   "linux.remote.ssh",
   "linux.security.selinux-contexts"
  ],
  "difficulty": "medium"
 },
 "xlp-netplan-address": {
  "title": "Apply a Netplan address change safely",
  "oneLine": "Change the secondary interface to the requested address through Netplan and apply it.",
  "minutes": 5,
  "skills": [
   "linux.net.persistent-config"
  ],
  "difficulty": "medium"
 },
 "xlp-lvm-raid-mount-opts": {
  "title": "Mount a volume with restrictive options",
  "oneLine": "Mount the given LV at the given path with noexec and nosuid, persistently.",
  "minutes": 4,
  "skills": [
   "linux.storage.mounts"
  ],
  "difficulty": "easy"
 },
 "xlp-backup-restore-tar": {
  "title": "Restore one directory from a backup archive",
  "oneLine": "Restore only the requested directory from the given archive to its original place with ownership intact.",
  "minutes": 4,
  "skills": [
   "linux.files.links-archives"
  ],
  "difficulty": "easy"
 },
 "xlp-fhs-locate-config": {
  "title": "Locate the files the auditor asks for",
  "oneLine": "Write the paths of the requested config, log and variable-data files of the given service to the answer file.",
  "minutes": 4,
  "skills": [
   "linux.files.find-locate"
  ],
  "difficulty": "easy"
 },
 "xlp-lvm-extend-vg": {
  "title": "Extend a volume group and logical volume",
  "oneLine": "Add the spare disk to the VG and grow the given LV and its filesystem by the requested size.",
  "minutes": 6,
  "skills": [
   "linux.storage.lvm"
  ],
  "difficulty": "medium"
 },
 "xlp-module-info": {
  "title": "Report and load a kernel module",
  "oneLine": "Load the given module and write its version and parameters to the answer file.",
  "minutes": 4,
  "skills": [
   "linux.kernel.modules"
  ],
  "difficulty": "easy"
 },
 "xlp-hardware-report": {
  "title": "Report CPU, memory and disks",
  "oneLine": "Write the CPU count, total memory and block device sizes of the host to the answer file in the requested format.",
  "minutes": 4,
  "skills": [
   "linux.kernel.hardware-discovery"
  ],
  "difficulty": "easy"
 },
 "xlp-raid-status": {
  "title": "Report and repair a RAID array's state",
  "oneLine": "Report the degraded array's state to the answer file and re-add the replacement disk.",
  "minutes": 6,
  "skills": [
   "linux.storage.raid"
  ],
  "difficulty": "medium"
 },
 "xlp-sysctl-runtime": {
  "title": "Change a kernel parameter persistently",
  "oneLine": "Set the given kernel parameter to the requested value now and at boot.",
  "minutes": 3,
  "skills": [
   "linux.kernel.sysctl"
  ],
  "difficulty": "easy"
 },
 "xlp-shell-pipeline": {
  "title": "Answer a question with a one-line pipeline",
  "oneLine": "Write the count of unique failed source addresses in the given log to the answer file.",
  "minutes": 4,
  "skills": [
   "linux.shell.text-processing"
  ],
  "difficulty": "easy"
 },
 "xlp-user-group-membership": {
  "title": "Fix a user's group membership",
  "oneLine": "Make the given user a member of the requested supplementary groups without removing existing ones.",
  "minutes": 3,
  "skills": [
   "linux.users.accounts"
  ],
  "difficulty": "easy"
 },
 "xlp-systemd-enable-mask": {
  "title": "Set the requested states of three units",
  "oneLine": "Leave the three given units enabled, disabled and masked as requested.",
  "minutes": 4,
  "skills": [
   "linux.systemd.units"
  ],
  "difficulty": "easy"
 },
 "xlp-container-network": {
  "title": "Run two containers on a shared network",
  "oneLine": "Run the two given containers on a user-defined network so the client reaches the server by name.",
  "minutes": 6,
  "skills": [
   "linux.internals.podman"
  ],
  "difficulty": "medium"
 },
 "xlp-pip-venv-tool": {
  "title": "Install a tool in a virtual environment from the offline index",
  "oneLine": "Create a venv at the given path and install the requested package version from the offline index.",
  "minutes": 4,
  "skills": [
   "linux.packages.language-envs"
  ],
  "difficulty": "easy"
 },
 "xlp-at-job": {
  "title": "Schedule a one-off job",
  "oneLine": "Schedule the given command to run once at the requested time as the given user.",
  "minutes": 3,
  "skills": [
   "linux.processes.scheduled-jobs"
  ],
  "difficulty": "easy"
 },
 "xlp-dns-dhcp-service": {
  "title": "Add a host record to the local DNS service",
  "oneLine": "Add the requested A and PTR records to the running local DNS service and make them resolve.",
  "minutes": 6,
  "skills": [
   "linux.services.dns-server"
  ],
  "difficulty": "medium"
 },
 "xlp-process-priority": {
  "title": "Renice a running process tree",
  "oneLine": "Lower the priority of the given process and all its children to the requested niceness.",
  "minutes": 3,
  "skills": [
   "linux.processes.management"
  ],
  "difficulty": "easy"
 },
 "xlp-web-vhost": {
  "title": "Add a virtual host to the web server",
  "oneLine": "Serve the given hostname from the given directory on the running web server.",
  "minutes": 6,
  "skills": [
   "linux.services.web-proxy"
  ],
  "difficulty": "medium"
 },
 "xlp-ufw-rules": {
  "title": "Allow two services and deny the rest with ufw",
  "oneLine": "Configure the host firewall to allow the two requested services and deny other inbound traffic.",
  "minutes": 4,
  "skills": [
   "linux.net.firewall"
  ],
  "difficulty": "easy"
 },
 "xlp-firewalld-rich-rule": {
  "title": "Add a firewalld rich rule for one subnet",
  "oneLine": "Allow the requested port only from the given subnet with a permanent rich rule.",
  "minutes": 5,
  "skills": [
   "linux.net.firewalld"
  ],
  "difficulty": "medium"
 },
 "xlp-sudoers-limited": {
  "title": "Grant one command via sudo",
  "oneLine": "Allow the given user to run only the requested command as root via a validated drop-in.",
  "minutes": 4,
  "skills": [
   "linux.users.sudo"
  ],
  "difficulty": "easy"
 },
 "xlp-ssh-disable-root": {
  "title": "Disable root and password SSH logins",
  "oneLine": "Disable root login and password authentication over SSH and keep key login for the given user working.",
  "minutes": 4,
  "skills": [
   "linux.security.ssh-hardening"
  ],
  "difficulty": "easy"
 },
 "xlp-luks-open-mount": {
  "title": "Open and mount an encrypted volume",
  "oneLine": "Unlock the given LUKS volume with the provided key file and mount it at the requested path.",
  "minutes": 5,
  "skills": [
   "linux.storage.luks"
  ],
  "difficulty": "medium"
 },
 "xlp-setuid-audit": {
  "title": "Remove an unexpected setuid bit",
  "oneLine": "Find the setuid file that is not on the approved list and remove its setuid bit.",
  "minutes": 5,
  "skills": [
   "linux.security.privilege-audit"
  ],
  "difficulty": "medium"
 },
 "xlp-faillock-policy": {
  "title": "Lock accounts after repeated failures",
  "oneLine": "Configure the authentication stack to lock an account after the requested number of failures.",
  "minutes": 6,
  "skills": [
   "linux.security.auth-hardening"
  ],
  "difficulty": "medium"
 },
 "xlp-checksum-verify": {
  "title": "Identify the tampered download",
  "oneLine": "Verify the downloads against the signed checksum list and write the name of the one that fails to the answer file.",
  "minutes": 4,
  "skills": [
   "linux.security.crypto"
  ],
  "difficulty": "easy"
 },
 "xlp-script-fix-loop": {
  "title": "Fix a broken loop in a provided script",
  "oneLine": "Correct the provided script so it processes every input line and produces the expected output file.",
  "minutes": 6,
  "skills": [
   "linux.shell.scripting"
  ],
  "difficulty": "medium"
 },
 "xlp-git-revert-commit": {
  "title": "Revert a bad commit and push",
  "oneLine": "Revert the commit that broke the config in the given repository and push the result.",
  "minutes": 5,
  "skills": [
   "linux.git.basics"
  ],
  "difficulty": "medium"
 },
 "xlp-python-parse-json": {
  "title": "Extract a value from JSON with a short Python script",
  "oneLine": "Write a Python script that prints the requested field from every record of the given JSON file.",
  "minutes": 6,
  "skills": [
   "linux.shell.python-basics"
  ],
  "difficulty": "medium"
 },
 "xlp-cloud-init-userdata": {
  "title": "Correct a cloud-init user-data file",
  "oneLine": "Fix the provided user-data so it creates the requested user and package set, validated by the cloud-init schema check.",
  "minutes": 6,
  "skills": [
   "linux.virt.cloud-init"
  ],
  "difficulty": "medium"
 },
 "xlp-sed-bulk-edit": {
  "title": "Change a setting in many config files at once",
  "oneLine": "Change the requested key's value in every matching config file under the given directory, leaving other lines intact.",
  "minutes": 4,
  "skills": [
   "linux.shell.regex-sed-awk"
  ],
  "difficulty": "easy"
 },
 "xlp-script-exit-codes": {
  "title": "Make a script return meaningful exit codes",
  "oneLine": "Change the provided health-check script to exit 0, 1 or 2 for the three documented states.",
  "minutes": 5,
  "skills": [
   "linux.shell.scripting"
  ],
  "difficulty": "easy"
 },
 "xlp-fix-disk-full": {
  "title": "Restore writes on a full filesystem",
  "oneLine": "Free space on the full filesystem so the given service can write again, without deleting protected data.",
  "minutes": 5,
  "skills": [
   "linux.storage.space-analysis"
  ],
  "difficulty": "medium"
 },
 "xlp-fix-unit-start": {
  "title": "Make a failing unit start",
  "oneLine": "Fix the given unit so it starts and stays active.",
  "minutes": 6,
  "skills": [
   "linux.systemd.unit-editing",
   "linux.systemd.journal"
  ],
  "difficulty": "medium"
 },
 "xlp-fix-dns-client": {
  "title": "Restore name resolution",
  "oneLine": "Make the given internal name resolve again from this host.",
  "minutes": 4,
  "skills": [
   "linux.net.name-resolution"
  ],
  "difficulty": "easy"
 },
 "xlp-fix-default-route": {
  "title": "Restore connectivity to the outside subnet",
  "oneLine": "Make the host reach the given remote subnet again by fixing its routing.",
  "minutes": 5,
  "skills": [
   "linux.net.ip-config",
   "linux.net.troubleshooting"
  ],
  "difficulty": "medium"
 },
 "xlp-fix-high-load": {
  "title": "Bring load back to normal",
  "oneLine": "Find the cause of the high load average and stop it without killing the protected service.",
  "minutes": 6,
  "skills": [
   "linux.performance.use-method"
  ],
  "difficulty": "medium"
 },
 "xlp-fix-permission-denied": {
  "title": "Fix a permission-denied error for an app user",
  "oneLine": "Let the given application user read its config again with the minimum permission change.",
  "minutes": 4,
  "skills": [
   "linux.files.permissions",
   "linux.files.acls"
  ],
  "difficulty": "easy"
 },
 "xlp-fix-oom-service": {
  "title": "Stop a service from being OOM-killed",
  "oneLine": "Identify why the given service is repeatedly OOM-killed and change the limit or culprit so it stays up.",
  "minutes": 8,
  "skills": [
   "linux.performance.memory"
  ],
  "difficulty": "hard"
 },
 "xlp-fix-time-skew": {
  "title": "Fix a skewed host clock",
  "oneLine": "TLS clients fail on this host; find the clock problem and make time synchronise with the lab server.",
  "minutes": 5,
  "skills": [
   "linux.net.time-sync"
  ],
  "difficulty": "medium"
 },
 "xct-build-media-containerfile": {
  "title": "Build the media API image from a Containerfile",
  "oneLine": "Write a Containerfile for the supplied media API that runs as UID 1001 from /opt/media, exposes 8080 and builds as localhost/media-api:1.0.",
  "minutes": 15,
  "skills": [
   "containers.build.dockerfile",
   "containers.build.non-root"
  ],
  "difficulty": "medium"
 },
 "xct-build-args-env": {
  "title": "Parameterise the build with a release argument",
  "oneLine": "Build localhost/caption-api:2.1 so a RELEASE build argument sets both an image label and the CAPTION_RELEASE environment variable seen by the running container.",
  "minutes": 8,
  "skills": [
   "containers.build.args-labels"
  ],
  "difficulty": "easy"
 },
 "xct-build-entrypoint-cmd": {
  "title": "Make the report tool accept arguments after the image name",
  "oneLine": "Rebuild localhost/report-tool so its program is the fixed entrypoint and --daily is only the default argument, so passing --weekly at run time replaces just the argument.",
  "minutes": 10,
  "skills": [
   "containers.build.entrypoint"
  ],
  "difficulty": "medium"
 },
 "xct-build-volume-selinux": {
  "title": "Serve host content through an image-declared volume",
  "oneLine": "Build localhost/static-web with /srv/www declared as a volume and run it as static-web with the host directory /exam/www mounted there with the correct SELinux label so pages are served on port 8081.",
  "minutes": 12,
  "skills": [
   "containers.build.dockerfile",
   "containers.storage.permissions"
  ],
  "difficulty": "medium"
 },
 "xct-build-arbitrary-uid": {
  "title": "Build an image that works under any assigned UID",
  "oneLine": "Adjust the queue-worker image so its data directory is group-0 owned and group-writable, letting the container start and write data when run with an arbitrary UID such as 1000650000.",
  "minutes": 12,
  "skills": [
   "containers.build.non-root"
  ],
  "difficulty": "hard"
 },
 "xct-build-multistage-small": {
  "title": "Ship the compiled helper in a small runtime image",
  "oneLine": "Build localhost/probe-helper:1.0 with a separate build stage so the final image contains the compiled helper but no compiler and is under 60 MB.",
  "minutes": 12,
  "skills": [
   "containers.build.multi-stage"
  ],
  "difficulty": "medium"
 },
 "xct-manage-registry-push": {
  "title": "Push to the authenticated exam registry over TLS",
  "oneLine": "Trust the exam registry's CA, log in as exam-push and push localhost/media-api:1.0 as registry.exam.example:5443/media/api:1.0 so it can be pulled back by digest.",
  "minutes": 10,
  "skills": [
   "containers.registry.run-registry",
   "containers.podman.registries-conf"
  ],
  "difficulty": "medium"
 },
 "xct-manage-short-names": {
  "title": "Make a short image name resolve unambiguously",
  "oneLine": "Configure the user's registries settings so podman pull ledger fetches registry.exam.example:5443/finance/ledger without prompting and without querying any other registry.",
  "minutes": 8,
  "skills": [
   "containers.podman.registries-conf"
  ],
  "difficulty": "medium"
 },
 "xct-manage-image-archive": {
  "title": "Back up an image to an archive file",
  "oneLine": "Save localhost/caption-api:2.1 with its tag to /exam/backup/caption-api.tar so loading the archive on a clean system recreates the tagged image.",
  "minutes": 6,
  "skills": [
   "containers.registry.portability"
  ],
  "difficulty": "easy"
 },
 "xct-manage-container-state": {
  "title": "Capture a modified container's state as a new image",
  "oneLine": "The running container tuner has hand-made changes; preserve its current filesystem as localhost/tuner:snapshot without stopping it.",
  "minutes": 6,
  "skills": [
   "containers.podman.state-portability"
  ],
  "difficulty": "easy"
 },
 "xct-run-ports-env": {
  "title": "Run a service with published port and environment",
  "oneLine": "Run localhost/media-api:1.0 as container media-api with MEDIA_REGION=north, publishing container port 8080 on host port 18080.",
  "minutes": 6,
  "skills": [
   "containers.foundations.lifecycle",
   "containers.network.publishing"
  ],
  "difficulty": "easy"
 },
 "xct-run-persistent-db": {
  "title": "Run a database whose data outlives the container",
  "oneLine": "Run the supplied PostgreSQL image as ledger-db with its data on the named volume ledger-data, so removing and recreating the container keeps the seeded table.",
  "minutes": 10,
  "skills": [
   "containers.storage.mount-types"
  ],
  "difficulty": "medium"
 },
 "xct-run-quadlet-service": {
  "title": "Run a container as a service that survives reboot",
  "oneLine": "Make the container media-api start automatically for user examuser at boot as a systemd service so it is running and answering on port 18080 after the grader reboots the system.",
  "minutes": 15,
  "skills": [
   "containers.podman.quadlet"
  ],
  "difficulty": "hard"
 },
 "xct-run-resource-limits": {
  "title": "Run a batch container under memory and pid limits",
  "oneLine": "Run localhost/batch-runner as batch-1 limited to 256 MiB of memory and 64 processes, restarting on failure up to three times.",
  "minutes": 6,
  "skills": [
   "containers.runtime-security.limits",
   "containers.operations.restart-health"
  ],
  "difficulty": "easy"
 },
 "xct-run-rootless-user": {
  "title": "Run a rootless container as a specific unprivileged user",
  "oneLine": "As examuser, run localhost/static-web rootless as container docs-web on host port 8082 with the process inside running as UID 1001.",
  "minutes": 8,
  "skills": [
   "containers.podman.rootless"
  ],
  "difficulty": "medium"
 },
 "xct-run-inspect-report": {
  "title": "Report runtime facts about running containers",
  "oneLine": "Write the IP address, image digest and restart count of the running container ingest-7 to /exam/ingest-facts.txt in the requested order.",
  "minutes": 6,
  "skills": [
   "containers.foundations.inspect"
  ],
  "difficulty": "easy"
 },
 "xct-multi-pod-api-db": {
  "title": "Assemble an API and database in one pod",
  "oneLine": "Create pod ledger-pod publishing 8085 with the ledger API and its database inside it, the API reaching the database on localhost and returning the ledger summary from outside.",
  "minutes": 15,
  "skills": [
   "containers.podman.pods"
  ],
  "difficulty": "medium"
 },
 "xct-multi-secret-password": {
  "title": "Share a database password through a secret",
  "oneLine": "Create secret ledger-db-pass and use it for both the database and the API containers so they connect while the password appears in no container's environment listing.",
  "minutes": 10,
  "skills": [
   "containers.podman.secrets"
  ],
  "difficulty": "medium"
 },
 "xct-multi-kube-play": {
  "title": "Start a multi-container application from Kubernetes YAML",
  "oneLine": "Start the application described in /exam/catalog.yaml with podman kube play, fixing the one wrong image reference in it, so its web container answers on host port 8086.",
  "minutes": 12,
  "skills": [
   "containers.podman.kube-play"
  ],
  "difficulty": "medium"
 },
 "xct-multi-network-dependency": {
  "title": "Connect a web tier to its cache by name",
  "oneLine": "Create network shop-net and run cache and web on it so web reaches the cache by the hostname cache and serves cached pages on host port 8087.",
  "minutes": 10,
  "skills": [
   "containers.network.bridge-dns"
  ],
  "difficulty": "easy"
 },
 "xct-trouble-crashloop": {
  "title": "Get a crash-looping container running",
  "oneLine": "Container metrics-agent exits immediately after start; read its logs, correct the misnamed configuration variable and leave it running.",
  "minutes": 10,
  "skills": [
   "containers.foundations.exec-logs",
   "containers.operations.exit-codes"
  ],
  "difficulty": "medium"
 },
 "xct-trouble-port-conflict": {
  "title": "Resolve a container that cannot bind its host port",
  "oneLine": "Container status-page fails to start because its host port is taken by a stray container; stop the stray one and start status-page so it serves on host port 8090.",
  "minutes": 8,
  "skills": [
   "containers.network.publishing",
   "containers.foundations.inspect"
  ],
  "difficulty": "easy"
 },
 "xct-trouble-selinux-mount": {
  "title": "Fix a container that cannot read its mounted data",
  "oneLine": "Container report-web returns 403 because it cannot read /exam/reports; fix the mount so it serves the reports while SELinux stays enforcing.",
  "minutes": 10,
  "skills": [
   "containers.storage.permissions"
  ],
  "difficulty": "medium"
 },
 "xct-trouble-exec-diagnose": {
  "title": "Find why a running service returns errors",
  "oneLine": "Container price-api answers every request with 500; inspect it from inside, find the unreadable file it depends on, fix it and confirm /health returns 200.",
  "minutes": 10,
  "skills": [
   "containers.foundations.exec-logs"
  ],
  "difficulty": "medium"
 },
 "xia-declarative-rewrite": {
  "title": "Replace a provisioning script with a declarative config",
  "oneLine": "Rewrite a shell script that creates three farm config files into a config producing identical files, idempotent on re-apply.",
  "minutes": 6,
  "skills": [
   "iac.foundations.concepts"
  ],
  "difficulty": "easy"
 },
 "xia-predict-plan-actions": {
  "title": "Predict plan actions for a change set",
  "oneLine": "Given a config, its state and a change, record in answer.json which addresses will be created, updated in place or replaced, then confirm with plan.",
  "minutes": 6,
  "skills": [
   "iac.foundations.concepts",
   "iac.state.inspection"
  ],
  "difficulty": "easy"
 },
 "xia-pin-provider-offline": {
  "title": "Constrain a provider and record its lock hashes",
  "oneLine": "Constrain the random provider to the approved minor range and produce a lock file with hashes for two platforms from the offline mirror.",
  "minutes": 5,
  "skills": [
   "iac.foundations.provider-install"
  ],
  "difficulty": "easy"
 },
 "xia-mirror-cli-config": {
  "title": "Install providers only from a filesystem mirror",
  "oneLine": "Write CLI configuration so providers install only from /opt/provider-mirror with direct downloads disabled, and init the telemetry stack.",
  "minutes": 6,
  "skills": [
   "iac.foundations.cli-config"
  ],
  "difficulty": "medium"
 },
 "xia-saved-plan-apply": {
  "title": "Apply a saved plan and destroy one stack",
  "oneLine": "Save a plan for the survey stack to survey.tfplan, apply exactly that plan, then destroy the scratch stack leaving the survey stack intact.",
  "minutes": 6,
  "skills": [
   "iac.foundations.workflow"
  ],
  "difficulty": "easy"
 },
 "xia-fmt-validate-gate": {
  "title": "Make a stack pass format and validation gates",
  "oneLine": "Fix the farm-alerts stack so fmt -check and validate both pass with the planned resources unchanged.",
  "minutes": 5,
  "skills": [
   "iac.foundations.style"
  ],
  "difficulty": "easy"
 },
 "xia-variable-validation": {
  "title": "Add a typed, validated input with a default",
  "oneLine": "Add variable farm_region restricted to three regions with a default, used in every resource label, and make an invalid value fail at plan.",
  "minutes": 6,
  "skills": [
   "iac.language.variables"
  ],
  "difficulty": "easy"
 },
 "xia-for-each-namespaces": {
  "title": "Create namespaces from a map with for_each",
  "oneLine": "Create one namespace per entry of the substations map with its voltage as a label, keyed by substation name.",
  "minutes": 7,
  "skills": [
   "iac.language.repetition",
   "iac.targets.kubernetes-helm"
  ],
  "difficulty": "medium"
 },
 "xia-ignore-operator-annotations": {
  "title": "Stop an operator's annotations from showing as drift",
  "oneLine": "The forecast Deployment shows changes on every plan because an operator writes annotations; make plans converge without removing them.",
  "minutes": 6,
  "skills": [
   "iac.language.lifecycle"
  ],
  "difficulty": "medium"
 },
 "xia-ordering-helm-secret": {
  "title": "Order a release after its credentials",
  "oneLine": "Make a clean apply of the collector stack succeed by ordering the Helm release after the Secret it mounts.",
  "minutes": 6,
  "skills": [
   "iac.language.dependencies"
  ],
  "difficulty": "medium"
 },
 "xia-precondition-label": {
  "title": "Refuse to plan into an unlabelled namespace",
  "oneLine": "Add a precondition so the dashboard stack fails at plan with a clear message when its namespace lacks the cost-centre label.",
  "minutes": 6,
  "skills": [
   "iac.quality.conditions"
  ],
  "difficulty": "medium"
 },
 "xia-check-block-endpoint": {
  "title": "Warn when the telemetry endpoint is unhealthy",
  "oneLine": "Add a check block that warns, without failing the apply, when the telemetry health endpoint does not return 200.",
  "minutes": 6,
  "skills": [
   "iac.quality.conditions"
  ],
  "difficulty": "medium"
 },
 "xia-sensitive-redaction": {
  "title": "Redact a password in plans and outputs",
  "oneLine": "Mark the broker password input and the output derived from it sensitive so neither appears in plan or output text.",
  "minutes": 5,
  "skills": [
   "iac.quality.secrets"
  ],
  "difficulty": "easy"
 },
 "xia-write-only-password": {
  "title": "Pass a generated password without storing it",
  "oneLine": "Generate the forecast database password as an ephemeral value and pass it through a write-only argument so the state holds no password.",
  "minutes": 8,
  "skills": [
   "iac.quality.secrets"
  ],
  "difficulty": "hard"
 },
 "xia-call-local-module": {
  "title": "Call a local module twice",
  "oneLine": "Call ./modules/farm-base for farms gullhaven and redmoor with their quota inputs and expose both namespace names as outputs.",
  "minutes": 6,
  "skills": [
   "iac.modules.authoring"
  ],
  "difficulty": "easy"
 },
 "xia-git-module-pin": {
  "title": "Pin a git module to a tag",
  "oneLine": "Switch the inland stack to the farm-base module on the internal Git server pinned to tag v1.3.0 and init it.",
  "minutes": 5,
  "skills": [
   "iac.modules.sources"
  ],
  "difficulty": "easy"
 },
 "xia-module-output-wiring": {
  "title": "Wire one module's output into another",
  "oneLine": "Feed the storage module's claim name into the workload module so the Deployment mounts it, with no hard-coded names.",
  "minutes": 7,
  "skills": [
   "iac.modules.authoring",
   "iac.language.outputs-locals"
  ],
  "difficulty": "medium"
 },
 "xia-module-input-contract": {
  "title": "Tighten a module's input contract",
  "oneLine": "Give module turbine-alerts typed inputs with validation and a description each so a wrong threshold type fails at plan.",
  "minutes": 6,
  "skills": [
   "iac.modules.authoring",
   "iac.quality.conditions"
  ],
  "difficulty": "medium"
 },
 "xia-s3-backend-migrate": {
  "title": "Migrate state to an S3 backend with locking",
  "oneLine": "Move the survey stack's local state to bucket saltmarsh-exam with lockfile locking and leave no local state file.",
  "minutes": 7,
  "skills": [
   "iac.state.backends",
   "iac.state.locking"
  ],
  "difficulty": "medium"
 },
 "xia-state-rename": {
  "title": "Rename a resource without recreating it",
  "oneLine": "Rename resource kubernetes_config_map.cfg to farm_settings so the plan shows a move and the ConfigMap keeps its UID.",
  "minutes": 5,
  "skills": [
   "iac.state.refactor"
  ],
  "difficulty": "easy"
 },
 "xia-import-namespace": {
  "title": "Bring an existing namespace under management",
  "oneLine": "Adopt the hand-made namespace storm-response with an import block so the following plan is empty.",
  "minutes": 6,
  "skills": [
   "iac.state.import"
  ],
  "difficulty": "medium"
 },
 "xia-debug-log-file": {
  "title": "Capture provider debug logs to a file",
  "oneLine": "Reproduce the failing plan with trace logging written to /var/log/iac/plan-trace.log and record the failing API path in answer.txt.",
  "minutes": 5,
  "skills": [
   "iac.operations.troubleshooting"
  ],
  "difficulty": "easy"
 },
 "xia-workspace-layout-design": {
  "title": "Lay out teams on a hosted workspace model",
  "oneLine": "Complete layout.yaml assigning the trading and telemetry teams' projects, workspaces and variable sets so the stated isolation rules hold.",
  "minutes": 5,
  "skills": [
   "iac.collaboration.hcp-concepts"
  ],
  "difficulty": "easy"
 },
 "xia-run-log-reading": {
  "title": "Read a hosted run export and answer from it",
  "oneLine": "From an exported remote run log and workspace settings, record which variable set and execution mode the failed run used.",
  "minutes": 5,
  "skills": [
   "iac.collaboration.hcp-concepts"
  ],
  "difficulty": "easy"
 },
 "xiv-import-bucket-fleet": {
  "title": "Adopt an unmanaged bucket fleet",
  "oneLine": "Bring the six hand-made telemetry archive buckets on the AWS-shaped endpoint under management with for_each and import blocks so the plan is empty.",
  "minutes": 25,
  "skills": [
   "iac.state.import",
   "iac.language.repetition",
   "iac.targets.aws-api"
  ],
  "difficulty": "hard"
 },
 "xiv-reconcile-sg-drift": {
  "title": "Reconcile a drifted security group",
  "oneLine": "Restore the trading desk's security group to the approved rule set after out-of-band edits, keeping the one rule change control approved.",
  "minutes": 20,
  "skills": [
   "iac.state.drift",
   "iac.state.import"
  ],
  "difficulty": "hard"
 },
 "xiv-adopt-workloads-generated": {
  "title": "Adopt running workloads with generated config",
  "oneLine": "Adopt the hand-deployed forecast Deployment and Service with generated configuration, clean the generated code and converge.",
  "minutes": 20,
  "skills": [
   "iac.state.import"
  ],
  "difficulty": "hard"
 },
 "xiv-replace-and-protect": {
  "title": "Replace a corrupted instance and protect its peer",
  "oneLine": "Force replacement of the corrupted pricing instance only, and protect the matching archive bucket against destroy.",
  "minutes": 15,
  "skills": [
   "iac.state.drift",
   "iac.language.lifecycle"
  ],
  "difficulty": "medium"
 },
 "xiv-subnets-from-map": {
  "title": "Derive subnets and routes from a zone map",
  "oneLine": "Replace hard-coded subnets with ones computed from a zone map via cidrsubnet, keeping existing subnets in place with moved blocks.",
  "minutes": 25,
  "skills": [
   "iac.language.functions",
   "iac.language.repetition",
   "iac.targets.aws-api"
  ],
  "difficulty": "hard"
 },
 "xiv-dynamic-ingress-rules": {
  "title": "Generate ingress rules from a service catalogue",
  "oneLine": "Generate NetworkPolicy ingress rules for each telemetry service from a catalogue variable with dynamic blocks.",
  "minutes": 20,
  "skills": [
   "iac.language.dynamic-blocks"
  ],
  "difficulty": "medium"
 },
 "xiv-conditional-env-resources": {
  "title": "Create resources only where the environment needs them",
  "oneLine": "Create the debug dashboard and its Service only in staging and the PodDisruptionBudget only in prod, from one configuration.",
  "minutes": 20,
  "skills": [
   "iac.language.expressions",
   "iac.language.repetition"
  ],
  "difficulty": "medium"
 },
 "xiv-templated-configmaps": {
  "title": "Render per-farm configuration from templates",
  "oneLine": "Render one ConfigMap per farm from a template file and a farm map so adding a farm needs only a map entry.",
  "minutes": 15,
  "skills": [
   "iac.language.functions",
   "iac.language.repetition"
  ],
  "difficulty": "medium"
 },
 "xiv-remote-state-consumer": {
  "title": "Consume another team's outputs from remote state",
  "oneLine": "Make the pricing stack read its subnet and bucket names from the network stack's remote state instead of literals, both converged.",
  "minutes": 20,
  "skills": [
   "iac.state.sharing"
  ],
  "difficulty": "medium"
 },
 "xiv-cross-stack-outputs": {
  "title": "Publish a stable output contract for other stacks",
  "oneLine": "Expose the network stack's ids as a versioned output object and update its two consumers so all three stacks plan empty.",
  "minutes": 25,
  "skills": [
   "iac.state.sharing",
   "iac.language.outputs-locals"
  ],
  "difficulty": "hard"
 },
 "xiv-extract-vpc-module": {
  "title": "Extract a network module without destroying anything",
  "oneLine": "Move the trading VPC, subnets and route tables into a local network module with moved blocks so the plan is empty.",
  "minutes": 25,
  "skills": [
   "iac.modules.refactor"
  ],
  "difficulty": "hard"
 },
 "xiv-module-upgrade-git": {
  "title": "Upgrade a shared module across a breaking release",
  "oneLine": "Upgrade farm-base from v1 to v2 on the internal Git server, adapting renamed inputs and moved resources with no recreation.",
  "minutes": 25,
  "skills": [
   "iac.modules.sources",
   "iac.state.refactor"
  ],
  "difficulty": "hard"
 },
 "xiv-split-workload-module": {
  "title": "Split workload resources into a module",
  "oneLine": "Split the forecast Deployment, Service and HPA into a workload module with a typed contract, preserving every object.",
  "minutes": 20,
  "skills": [
   "iac.modules.refactor",
   "iac.modules.authoring"
  ],
  "difficulty": "medium"
 },
 "xiv-module-for-each": {
  "title": "Instantiate a module per farm",
  "oneLine": "Replace three copy-pasted module calls with one module for_each over a farm map, keeping all resources in place.",
  "minutes": 20,
  "skills": [
   "iac.modules.authoring",
   "iac.state.refactor"
  ],
  "difficulty": "medium"
 },
 "xiv-provider-alias-regions": {
  "title": "Deploy a replica bucket in a second region",
  "oneLine": "Add an aliased AWS-shaped provider for the second region and create the replica archive bucket there from the same module.",
  "minutes": 20,
  "skills": [
   "iac.language.provider-config",
   "iac.modules.provider-passing"
  ],
  "difficulty": "medium"
 },
 "xiv-provider-major-upgrade": {
  "title": "Complete a forced provider major upgrade",
  "oneLine": "Upgrade the telemetry stack to the next kubernetes provider major, fix its removed attributes and leave the lock file and plan clean.",
  "minutes": 25,
  "skills": [
   "iac.operations.upgrades"
  ],
  "difficulty": "hard"
 },
 "xiv-fix-provider-auth": {
  "title": "Repair a broken provider configuration",
  "oneLine": "The inland stack cannot authenticate to its cluster; diagnose from logs and fix the provider configuration without static secrets in code.",
  "minutes": 15,
  "skills": [
   "iac.operations.troubleshooting",
   "iac.language.provider-config"
  ],
  "difficulty": "medium"
 },
 "xiv-provider-endpoints": {
  "title": "Point a provider at private service endpoints",
  "oneLine": "Configure the AWS-shaped provider for the private endpoint set, path-style buckets and skipped metadata checks so plan and apply work offline.",
  "minutes": 15,
  "skills": [
   "iac.language.provider-config",
   "iac.targets.aws-api"
  ],
  "difficulty": "medium"
 },
 "xan-baseline-control-user": {
  "title": "Prepare the exam control node account",
  "oneLine": "On the control node, create user devops with an SSH key pair and a project directory /home/devops/ansible owned by it, and confirm the key is accepted by every managed node's devops account.",
  "minutes": 8,
  "skills": [
   "linux.users.accounts",
   "linux.remote.ssh"
  ],
  "difficulty": "easy"
 },
 "xan-baseline-script-output": {
  "title": "Run a provided script and capture its result",
  "oneLine": "A supplied shell script prints the host's role; run it on the control node with the given argument and save only its last line to /home/devops/role.txt.",
  "minutes": 6,
  "skills": [
   "linux.shell.scripting",
   "linux.shell.redirection"
  ],
  "difficulty": "easy"
 },
 "xan-core-adhoc-repos": {
  "title": "Configure repositories on every node with an ad-hoc script",
  "oneLine": "Write /home/devops/ansible/repos.sh that uses only ad-hoc commands to configure the BaseOS and AppStream repositories from the exam mirror with GPG checking on every node; it must run cleanly twice.",
  "minutes": 12,
  "skills": [
   "automation.foundations.adhoc",
   "automation.modules.packages-services"
  ],
  "difficulty": "medium"
 },
 "xan-core-loop-groups-users": {
  "title": "Create users from a list with per-group rules",
  "oneLine": "From the supplied user_list.yml, create users whose job is developer on dev hosts with supplementary group devops and users whose job is manager on prod hosts with group opsmgr, all with UIDs from the file.",
  "minutes": 15,
  "skills": [
   "automation.control-flow.loops",
   "automation.modules.users",
   "automation.control-flow.conditionals"
  ],
  "difficulty": "medium"
 },
 "xan-core-facts-hwreport": {
  "title": "Write a hardware report from facts",
  "oneLine": "Produce /root/hwreport.txt on each managed node with inventory hostname, memory in MiB, BIOS version and the size of disk vdb, writing NONE for any value the host lacks.",
  "minutes": 15,
  "skills": [
   "automation.data.facts",
   "automation.modules.files"
  ],
  "difficulty": "medium"
 },
 "xan-core-handler-web": {
  "title": "Deploy a web server that restarts only on change",
  "oneLine": "Install and enable httpd on the web group, deploy the supplied index file and a config change through a handler, and make a second run report no changes.",
  "minutes": 12,
  "skills": [
   "automation.control-flow.handlers",
   "automation.modules.packages-services"
  ],
  "difficulty": "easy"
 },
 "xan-inventory-groups-cfg": {
  "title": "Build the exam inventory and project configuration",
  "oneLine": "Create an inventory with groups dev, test, prod and balancers plus a parent group webservers containing prod, and an ansible.cfg that sets that inventory, the roles and collections paths and remote user devops.",
  "minutes": 10,
  "skills": [
   "automation.inventory.static",
   "automation.foundations.config"
  ],
  "difficulty": "easy"
 },
 "xan-inventory-connection-overrides": {
  "title": "Reach a node on a non-standard SSH port",
  "oneLine": "One managed node listens for SSH on port 2202 under a different address; add the per-host connection overrides so every node answers a ping without changing the node.",
  "minutes": 8,
  "skills": [
   "automation.inventory.connection-vars"
  ],
  "difficulty": "easy"
 },
 "xan-nodes-bootstrap-keys": {
  "title": "Bootstrap managed nodes with a key and sudo rule",
  "oneLine": "Using the one-time root password, create user devops on every managed node with the control node's public key and passwordless sudo in a drop-in file, then disable password login for devops.",
  "minutes": 12,
  "skills": [
   "automation.inventory.bootstrap"
  ],
  "difficulty": "medium"
 },
 "xan-nodes-become-defaults": {
  "title": "Set privilege escalation defaults for the project",
  "oneLine": "Configure the project so plays escalate with sudo to root by default without prompting, except the reporting group which must run unprivileged, and show both behaviours with a whoami play.",
  "minutes": 10,
  "skills": [
   "automation.advanced.privilege",
   "automation.foundations.config"
  ],
  "difficulty": "medium"
 },
 "xan-run-navigator-artifact": {
  "title": "Run a playbook through navigator and keep its artifact",
  "oneLine": "Configure navigator to run without an execution environment in stdout mode with artifacts saved under /home/devops/ansible/artifacts, then run the supplied playbook so its artifact file exists.",
  "minutes": 8,
  "skills": [
   "automation.devworkflow.navigator"
  ],
  "difficulty": "easy"
 },
 "xan-run-limit-tags": {
  "title": "Run part of a playbook against part of the fleet",
  "oneLine": "Run only the tasks tagged motd from the supplied site playbook against the test group only, with both ansible-playbook and navigator, leaving all other hosts untouched.",
  "minutes": 8,
  "skills": [
   "automation.content.tags",
   "automation.devworkflow.navigator"
  ],
  "difficulty": "easy"
 },
 "xan-git-push-project": {
  "title": "Commit and push the exam project",
  "oneLine": "Clone the exam repository, add your playbooks under playbooks/, exclude artifacts and vault password files, and push to branch exam so the server holds every playbook you wrote.",
  "minutes": 8,
  "skills": [
   "automation.devworkflow.git"
  ],
  "difficulty": "easy"
 },
 "xan-git-branch-fix-run": {
  "title": "Fix a playbook from another branch and run it",
  "oneLine": "Check out branch hotfix from the exam repository, fix the broken task it contains, commit with the given message, push it and run the playbook so its end state appears on the dev hosts.",
  "minutes": 12,
  "skills": [
   "automation.devworkflow.git",
   "automation.quality.debugging"
  ],
  "difficulty": "medium"
 },
 "xan-errors-block-rescue-file": {
  "title": "Fall back when a configuration file is missing",
  "oneLine": "Append a line to /etc/exam/app.conf on all nodes; where the file is missing, create it from a template in a rescue block, and always write a timestamped line to /var/log/exam-run.log.",
  "minutes": 12,
  "skills": [
   "automation.control-flow.error-handling"
  ],
  "difficulty": "medium"
 },
 "xan-errors-failed-when-check": {
  "title": "Fail a play on an unacceptable command result",
  "oneLine": "Run the supplied health command on every node, register it, and fail the host with the message 'health check failed' when its output contains DEGRADED, without stopping the play on other hosts.",
  "minutes": 10,
  "skills": [
   "automation.control-flow.error-handling",
   "automation.data.register"
  ],
  "difficulty": "medium"
 },
 "xan-errors-register-branch": {
  "title": "Branch on a registered package query",
  "oneLine": "Query whether the legacy agent package is installed on each node, remove it and install the new agent only where it was present, and write the list of migrated hosts to /home/devops/migrated.txt.",
  "minutes": 12,
  "skills": [
   "automation.data.register",
   "automation.control-flow.conditionals"
  ],
  "difficulty": "medium"
 },
 "xan-errors-wait-service": {
  "title": "Wait for a slow service before continuing",
  "oneLine": "Start the supplied slow-starting service on the prod hosts and retry its status URL until it returns 200, at most 10 attempts 5 seconds apart, before deploying the page that depends on it.",
  "minutes": 10,
  "skills": [
   "automation.control-flow.retries"
  ],
  "difficulty": "medium"
 },
 "xan-roles-requirements": {
  "title": "Install roles and a collection from the exam share",
  "oneLine": "Install the two roles and one collection listed in the supplied requirements file from the exam file share into the project's roles and collections paths, under the names given.",
  "minutes": 8,
  "skills": [
   "automation.reuse.collections"
  ],
  "difficulty": "easy"
 },
 "xan-roles-author-web": {
  "title": "Write a web role driven by defaults",
  "oneLine": "Create role webpage that installs httpd, opens the firewall and renders an index page showing the host's FQDN and IPv4 address from a template, and apply it to the webservers group.",
  "minutes": 18,
  "skills": [
   "automation.reuse.roles",
   "automation.content.templates"
  ],
  "difficulty": "medium"
 },
 "xan-roles-system-timesync": {
  "title": "Configure time sources with the timesync system role",
  "oneLine": "Use the timesync system role so every node uses the exam NTP server with iburst and sources survive a reboot.",
  "minutes": 10,
  "skills": [
   "automation.reuse.system-roles"
  ],
  "difficulty": "easy"
 },
 "xan-roles-system-selinux": {
  "title": "Set SELinux state with the selinux system role",
  "oneLine": "Use the selinux system role to put all nodes in enforcing mode with the targeted policy and enable the boolean that lets httpd reach the network, persisting across a reboot.",
  "minutes": 12,
  "skills": [
   "automation.reuse.system-roles",
   "automation.modules.firewall-selinux"
  ],
  "difficulty": "medium"
 },
 "xan-roles-galaxy-role-use": {
  "title": "Use an installed role with overridden variables",
  "oneLine": "Apply the installed balancer role to the balancers group with the webservers as backends by overriding its documented variables, so the balancer page alternates between backends.",
  "minutes": 12,
  "skills": [
   "automation.reuse.roles",
   "automation.data.variables"
  ],
  "difficulty": "medium"
 },
 "xan-roles-argument-spec": {
  "title": "Reject invalid input to a role",
  "oneLine": "Add an argument spec to role report so it requires report_dir as a path and report_level as one of brief or full, and show a run with an invalid level fails before any task runs.",
  "minutes": 10,
  "skills": [
   "automation.reuse.argument-specs"
  ],
  "difficulty": "medium"
 },
 "xan-sys-lvm-volumes": {
  "title": "Create logical volumes where capacity allows",
  "oneLine": "Create LV data of 1500 MiB in VG research on all nodes, falling back to 800 MiB with a warning where the VG is too small and printing 'volume group does not exist' where it is missing; format ext4 without mounting.",
  "minutes": 20,
  "skills": [
   "automation.modules.storage",
   "automation.control-flow.error-handling"
  ],
  "difficulty": "hard"
 },
 "xan-sys-partition-mount": {
  "title": "Partition a disk and mount it persistently",
  "oneLine": "On the test hosts create a 1 GiB partition on vdc, format it xfs and mount it at /mnt/archive by UUID so it is mounted after a reboot.",
  "minutes": 15,
  "skills": [
   "automation.modules.storage"
  ],
  "difficulty": "medium"
 },
 "xan-sys-vault-users": {
  "title": "Create users with vaulted password hashes",
  "oneLine": "Create the users in the supplied list with password hashes derived from a vault-encrypted variable file and its password file, using SHA-512 hashes and the group memberships given.",
  "minutes": 15,
  "skills": [
   "automation.modules.users",
   "automation.content.vault"
  ],
  "difficulty": "medium"
 },
 "xan-sys-cron-at": {
  "title": "Schedule a recurring and a one-off job",
  "oneLine": "Install a cron job for user natasha that logs a heartbeat every two minutes and an at job that writes a marker file in 30 minutes on the dev hosts, with the cron job surviving re-runs without duplicates.",
  "minutes": 10,
  "skills": [
   "automation.modules.scheduling"
  ],
  "difficulty": "easy"
 },
 "xan-sys-firewalld-selinux-web": {
  "title": "Publish web content from a custom directory with SELinux enforcing",
  "oneLine": "Serve /webdev on the dev hosts through httpd with the correct SELinux context, a symlink from the document root, a group-owned setgid directory for webdev users and the http service open in firewalld permanently.",
  "minutes": 20,
  "skills": [
   "automation.modules.firewall-selinux",
   "automation.modules.files"
  ],
  "difficulty": "hard"
 },
 "xan-sys-boot-target-sysctl": {
  "title": "Set the default target and a persistent kernel parameter",
  "oneLine": "Set multi-user as the default target on all nodes and vm.swappiness to 10 persistently on the prod hosts, both verified after the grader's reboot.",
  "minutes": 10,
  "skills": [
   "automation.modules.boot-kernel"
  ],
  "difficulty": "easy"
 },
 "xan-sys-archive-fetch": {
  "title": "Archive configuration and fetch it to the control node",
  "oneLine": "Archive /etc/httpd on the webservers into a bzip2 tarball named after the host and fetch each archive into /home/devops/backups on the control node.",
  "minutes": 8,
  "skills": [
   "automation.modules.archives"
  ],
  "difficulty": "easy"
 },
 "xan-sys-packages-groups": {
  "title": "Install package groups by host group",
  "oneLine": "Install php and mariadb on dev, test and prod hosts, the Development Tools group on dev hosts only, and update every package on dev hosts to the latest mirror version.",
  "minutes": 10,
  "skills": [
   "automation.modules.packages-services"
  ],
  "difficulty": "easy"
 },
 "xan-tpl-hosts-file": {
  "title": "Generate a hosts file from inventory facts",
  "oneLine": "Render /etc/myhosts on the dev hosts from a template that lists every inventory host's IPv4 address, FQDN and short name in the same format as /etc/hosts.",
  "minutes": 15,
  "skills": [
   "automation.content.templates",
   "automation.data.facts"
  ],
  "difficulty": "medium"
 },
 "xan-tpl-vault-rekey": {
  "title": "Create and rekey an encrypted variables file",
  "oneLine": "Create locker.yml with two given variables encrypted with the first vault password, then rekey it to the second password stored in secret.txt, leaving the content unchanged.",
  "minutes": 8,
  "skills": [
   "automation.content.vault"
  ],
  "difficulty": "easy"
 },
 "xnt-subnet-admin-block": {
  "title": "Address a new admin VLAN from a given block",
  "oneLine": "Choose the smallest subnet of 10.60.8.0/21 that fits 200 administration hosts, configure the gateway and two hosts with it, and make both reach the gateway.",
  "minutes": 8,
  "skills": [
   "net.addressing.ipv4-subnetting"
  ],
  "difficulty": "medium"
 },
 "xnt-ipv6-office-slaac": {
  "title": "Give an office LAN IPv6 with SLAAC",
  "oneLine": "Assign the given global /64 to the office router interface and advertise it so both office hosts autoconfigure and reach the router over IPv6.",
  "minutes": 8,
  "skills": [
   "net.addressing.ipv6",
   "net.addressing.ipv6-slaac"
  ],
  "difficulty": "medium"
 },
 "xnt-fix-host-gateway": {
  "title": "Repair a host's addressing and gateway",
  "oneLine": "A staff host on the north campus cannot leave its subnet; correct its prefix length and default gateway so it reaches the district office server.",
  "minutes": 5,
  "skills": [
   "net.addressing.ipv4-subnetting",
   "net.troubleshooting.methodology"
  ],
  "difficulty": "easy"
 },
 "xnt-capture-dns-transport": {
  "title": "Record the transport details of a name lookup",
  "oneLine": "Capture a name lookup from the annex host and write the transport protocol, the server port and the client port it used to the given file.",
  "minutes": 6,
  "skills": [
   "net.fundamentals.tcp-udp-ports",
   "net.troubleshooting.packet-capture"
  ],
  "difficulty": "easy"
 },
 "xnt-neighbour-link-local": {
  "title": "Report a neighbour's link-local and MAC address",
  "oneLine": "Write the IPv6 link-local address and MAC address of the router that is the east campus default gateway to the given file, taken from the host's neighbour table.",
  "minutes": 5,
  "skills": [
   "net.fundamentals.arp-nd",
   "net.addressing.ipv6"
  ],
  "difficulty": "easy"
 },
 "xnt-summary-route": {
  "title": "Summarise four campus subnets into one route",
  "oneLine": "Replace the four static routes for the north campus subnets on the core router with the single smallest summary route that covers all four and nothing more.",
  "minutes": 8,
  "skills": [
   "net.addressing.ipv4-subnetting",
   "net.routing.static"
  ],
  "difficulty": "medium"
 },
 "xnt-vlan-guest-ports": {
  "title": "Move two switch ports into a guest VLAN",
  "oneLine": "Place two library ports on the south switch into a new guest VLAN 50 so the hosts there reach each other but no other VLAN on that switch.",
  "minutes": 6,
  "skills": [
   "net.switching.vlans"
  ],
  "difficulty": "easy"
 },
 "xnt-trunk-allowed-vlans": {
  "title": "Restrict a trunk to the required VLANs",
  "oneLine": "Change the north-campus trunk so it carries only VLANs 20, 30 and 50 with VLAN 99 native, keeping hosts in those VLANs reachable across it.",
  "minutes": 8,
  "skills": [
   "net.switching.trunking"
  ],
  "difficulty": "medium"
 },
 "xnt-native-vlan-repair": {
  "title": "Repair a trunk that leaks between VLANs",
  "oneLine": "Find and fix the native VLAN mismatch on the annex trunk so management hosts no longer reach student hosts and both VLANs still cross the trunk.",
  "minutes": 8,
  "skills": [
   "net.switching.trunking",
   "net.troubleshooting.methodology"
  ],
  "difficulty": "medium"
 },
 "xnt-rstp-root-choice": {
  "title": "Make a chosen switch the spanning-tree root",
  "oneLine": "Set rapid spanning tree priorities so the data-centre switch is root for the campus triangle and the named access link is the blocked one.",
  "minutes": 8,
  "skills": [
   "net.switching.stp"
  ],
  "difficulty": "medium"
 },
 "xnt-lacp-server-bond": {
  "title": "Bundle two server links with LACP",
  "oneLine": "Aggregate the two links to the backup server with LACP so the bundle is up with both members active and the server survives losing either link.",
  "minutes": 8,
  "skills": [
   "net.switching.etherchannel"
  ],
  "difficulty": "medium"
 },
 "xnt-inter-vlan-annex": {
  "title": "Route between two annex VLANs on one link",
  "oneLine": "Add 802.1Q subinterfaces on the annex router for VLANs 20 and 30 so hosts in each VLAN reach the other through their gateway.",
  "minutes": 8,
  "skills": [
   "net.switching.inter-vlan"
  ],
  "difficulty": "medium"
 },
 "xnt-static-campus-reachability": {
  "title": "Restore reachability between two campuses with static routes",
  "oneLine": "Add the static routes needed so the south and east campus LANs reach each other in both directions through the core.",
  "minutes": 6,
  "skills": [
   "net.routing.static"
  ],
  "difficulty": "easy"
 },
 "xnt-floating-backup-route": {
  "title": "Add a backup route that is used only on failure",
  "oneLine": "Add a floating static route over the radio link so the annex keeps reaching the core when the grader takes the fibre down, and the fibre path stays preferred while it is up.",
  "minutes": 8,
  "skills": [
   "net.routing.floating-static"
  ],
  "difficulty": "medium"
 },
 "xnt-ipv6-default-route": {
  "title": "Give a campus router an IPv6 default route",
  "oneLine": "Configure an IPv6 default route on the north campus router via the core router's link-local address so north IPv6 hosts reach the district office.",
  "minutes": 6,
  "skills": [
   "net.routing.ipv6-static"
  ],
  "difficulty": "medium"
 },
 "xnt-ospf-join-router": {
  "title": "Add a router to the OSPF backbone area",
  "oneLine": "Enable OSPFv2 area 0 on the new vocational annex router with the given router ID so its two LANs appear in every district routing table.",
  "minutes": 8,
  "skills": [
   "net.routing.ospf"
  ],
  "difficulty": "medium"
 },
 "xnt-ospf-dr-election": {
  "title": "Control the DR on a shared segment",
  "oneLine": "Make the named router DR and stop the other router from ever becoming DR or BDR on the data-centre segment, with all adjacencies Full afterwards.",
  "minutes": 8,
  "skills": [
   "net.routing.ospf-tuning"
  ],
  "difficulty": "medium"
 },
 "xnt-ospf-adjacency-repair": {
  "title": "Repair an OSPF neighbour that never reaches Full",
  "oneLine": "Find the parameter mismatch that keeps the east campus router out of Full state with the core, fix it and confirm the east LAN is learned by OSPF.",
  "minutes": 10,
  "skills": [
   "net.routing.ospf",
   "net.troubleshooting.methodology"
  ],
  "difficulty": "medium"
 },
 "xnt-vrrp-lab-gateway": {
  "title": "Provide a redundant gateway with VRRP",
  "oneLine": "Configure VRRP on the two science-wing routers with the given virtual address and priorities so hosts keep reaching the core when the master is shut down.",
  "minutes": 10,
  "skills": [
   "net.routing.vrrp"
  ],
  "difficulty": "medium"
 },
 "xnt-route-preference-report": {
  "title": "Report which route forwards to a destination and why",
  "oneLine": "For three given destinations, write the prefix, source protocol and next hop the core router actually forwards with to the given file, where overlapping static and OSPF routes exist.",
  "minutes": 6,
  "skills": [
   "net.routing.route-selection"
  ],
  "difficulty": "medium"
 },
 "xnt-dhcp-pool-reservation": {
  "title": "Add a DHCP pool with one reservation",
  "oneLine": "Add a DHCP pool for the new guest VLAN with the correct gateway and DNS options and reserve one fixed address for the guest kiosk's MAC address.",
  "minutes": 8,
  "skills": [
   "net.services.dhcp"
  ],
  "difficulty": "easy"
 },
 "xnt-dhcp-relay-annex": {
  "title": "Relay DHCP for a remote subnet",
  "oneLine": "Configure the annex router to relay DHCP to the data-centre server so annex student hosts lease addresses from their own pool.",
  "minutes": 8,
  "skills": [
   "net.services.dhcp-relay"
  ],
  "difficulty": "medium"
 },
 "xnt-pat-student-vlan": {
  "title": "Translate a VLAN to the edge address",
  "oneLine": "Add port address translation on the edge router so the new guest VLAN reaches the outside network using the edge's outside address, and no other subnet is affected.",
  "minutes": 8,
  "skills": [
   "net.services.nat"
  ],
  "difficulty": "medium"
 },
 "xnt-ntp-syslog-client": {
  "title": "Point a router at the district time and log servers",
  "oneLine": "Make the east campus router synchronise time from the core and send messages of severity warning and above to the central syslog server.",
  "minutes": 6,
  "skills": [
   "net.services.ntp",
   "net.services.syslog"
  ],
  "difficulty": "easy"
 },
 "xnt-acl-printer-subnet": {
  "title": "Allow only print traffic into the printer subnet",
  "oneLine": "Filter traffic into the printer subnet so only staff hosts reach printers on TCP 631 and 9100 and all other traffic into that subnet is dropped.",
  "minutes": 10,
  "skills": [
   "net.security.acls"
  ],
  "difficulty": "medium"
 },
 "xnt-mgmt-ssh-only": {
  "title": "Restrict router management to SSH from admins",
  "oneLine": "Allow management of the south campus router only over SSH from the network-admin subnet and refuse it from everywhere else.",
  "minutes": 8,
  "skills": [
   "net.security.device-hardening"
  ],
  "difficulty": "medium"
 },
 "xnt-wireguard-annex": {
  "title": "Bring up a site-to-site tunnel with given keys",
  "oneLine": "Complete the half-built WireGuard tunnel between the edge and the annex with the provided keys and route the annex staff subnet through it.",
  "minutes": 10,
  "skills": [
   "net.security.wireguard"
  ],
  "difficulty": "medium"
 },
 "xnt-snmpv3-only": {
  "title": "Replace community-based SNMP with SNMPv3",
  "oneLine": "Remove community-based SNMP access from the edge router and add the given authenticated and encrypted SNMPv3 user readable only from the monitoring host.",
  "minutes": 8,
  "skills": [
   "net.services.snmp",
   "net.security.device-hardening"
  ],
  "difficulty": "medium"
 },
 "xnt-api-interface-desc": {
  "title": "Set interface descriptions through a device API",
  "oneLine": "Using the switch's JSON-RPC API, set the descriptions given in a YAML file on three ports and write the API's response for one port to the given file.",
  "minutes": 10,
  "skills": [
   "net.automation.json-rpc"
  ],
  "difficulty": "medium"
 },
 "xnt-render-config-from-yaml": {
  "title": "Render a router config from structured data",
  "oneLine": "Complete the provided Jinja2 template so it renders the annex router's interface addresses from the given YAML, apply the result and make the annex LANs reachable.",
  "minutes": 10,
  "skills": [
   "net.automation.config-templates"
  ],
  "difficulty": "medium"
 },
 "xpe-host-baseline-service": {
  "title": "Bring a build host to the platform baseline",
  "oneLine": "Configure qm-build-1 so the svc-ci user owns /srv/ci with setgid group sharing, a systemd unit ci-agent.service starts at boot after the network is online, and the journal is persistent.",
  "minutes": 20,
  "skills": [
   "linux.files.permissions",
   "linux.systemd.unit-editing",
   "linux.systemd.journal"
  ],
  "difficulty": "medium"
 },
 "xpe-host-disk-and-mount": {
  "title": "Give the artefact cache its own volume",
  "oneLine": "On qm-build-2 create a 2 GiB logical volume from the spare disk, format it XFS and mount it persistently at /var/cache/artefacts by UUID with noexec so it survives a reboot.",
  "minutes": 20,
  "skills": [
   "linux.storage.lvm",
   "linux.storage.filesystems",
   "linux.storage.mounts"
  ],
  "difficulty": "medium"
 },
 "xpe-image-build-push": {
  "title": "Build and publish the tracking API image",
  "oneLine": "Build the harbour-tracking API from its Containerfile as a multi-stage image that runs as UID 10001, tag it by version and digest, and push it to the lab registry where the grader pulls it by digest.",
  "minutes": 20,
  "skills": [
   "k8s.delivery.image-build",
   "k8s.security.image-footprint"
  ],
  "difficulty": "medium"
 },
 "xpe-image-sign-verify": {
  "title": "Sign the release image and attach its SBOM",
  "oneLine": "Generate an SBOM for the tracking API image, sign the image with the platform key pair, and leave both attached as referrers in the lab registry so verification with the public key succeeds.",
  "minutes": 20,
  "skills": [
   "k8s.security.sbom",
   "k8s.security.image-signing"
  ],
  "difficulty": "hard"
 },
 "xpe-compose-local-stack": {
  "title": "Run the tracking stack locally with health ordering",
  "oneLine": "Write a Compose file that starts the tracking API only after its Postgres service reports healthy, persists the database in a named volume and publishes the API on 127.0.0.1:8080 only.",
  "minutes": 15,
  "skills": [
   "k8s.workloads.probes",
   "k8s.delivery.image-build"
  ],
  "difficulty": "medium"
 },
 "xpe-image-slim-fix": {
  "title": "Shrink and fix a failing release image",
  "oneLine": "The label-printer image is 900 MB and ignores SIGTERM; rebuild it under 120 MB on a minimal base with an exec-form entrypoint so docker stop finishes in under 3 seconds.",
  "minutes": 20,
  "skills": [
   "k8s.delivery.image-build",
   "k8s.security.image-footprint"
  ],
  "difficulty": "medium"
 },
 "xpe-tofu-namespace-baseline": {
  "title": "Provision tenant namespaces with a reusable module",
  "oneLine": "Write a local OpenTofu module that creates a namespace with a ResourceQuota and a default-deny NetworkPolicy, call it for three Quillmoor teams with for_each, and leave state in the lab S3 bucket with locking so a re-plan shows no changes.",
  "minutes": 25,
  "skills": [
   "k8s.workloads.quotas-limitranges",
   "k8s.security.netpol-default-deny"
  ],
  "difficulty": "hard"
 },
 "xpe-tofu-import-drift": {
  "title": "Adopt hand-made cluster objects into state",
  "oneLine": "Bring the hand-created ConfigMap and Service of the tracking stack under OpenTofu management with import blocks, reconcile one drifted label, and finish with a plan that reports no changes.",
  "minutes": 25,
  "skills": [
   "k8s.cli.manifests",
   "k8s.networking.services"
  ],
  "difficulty": "hard"
 },
 "xpe-ansible-node-agents": {
  "title": "Roll the node agent out to the build fleet",
  "oneLine": "Write a playbook that installs the node-agent package from the local mirror on every host in the builders group, templates its config from inventory variables and restarts it only when the config changes, idempotent on a second run.",
  "minutes": 20,
  "skills": [
   "linux.packages.apt",
   "linux.systemd.units"
  ],
  "difficulty": "medium"
 },
 "xpe-ansible-ssh-hardening": {
  "title": "Enforce the SSH baseline across the fleet",
  "oneLine": "Write a role that disables password and root login in sshd, allows only the ops group and validates the config before reloading, applied to all build hosts with no changes reported on a re-run.",
  "minutes": 20,
  "skills": [
   "linux.remote.ssh",
   "linux.users.sudo"
  ],
  "difficulty": "medium"
 },
 "xpe-k8s-deploy-tracking": {
  "title": "Deploy the tracking API with probes and limits",
  "oneLine": "Deploy the signed tracking API image by digest to qm-harbour with 3 replicas, readiness and liveness probes, requests and limits, config from a ConfigMap and a ClusterIP Service selecting only its Pods.",
  "minutes": 20,
  "skills": [
   "k8s.workloads.deployments",
   "k8s.workloads.probes",
   "k8s.workloads.resources",
   "k8s.networking.services"
  ],
  "difficulty": "medium"
 },
 "xpe-k8s-ingress-route": {
  "title": "Route the public tracking host to the API",
  "oneLine": "Publish the tracking API under host track.quillmoor.example path /api through the cluster's Ingress controller with TLS from the provided certificate Secret.",
  "minutes": 15,
  "skills": [
   "k8s.networking.ingress-gateway",
   "k8s.security.ingress-tls"
  ],
  "difficulty": "medium"
 },
 "xpe-worker-notready-recovery": {
  "title": "Return a NotReady worker to service",
  "oneLine": "Worker harbour-wk-2 went NotReady after the node-agent rollout; find the cause in the kubelet journal, repair it and confirm the node schedules Pods again.",
  "minutes": 20,
  "skills": [
   "k8s.troubleshooting.nodes",
   "k8s.cluster.kubelet"
  ],
  "difficulty": "hard"
 },
 "xpe-k8s-autoscale-tracking": {
  "title": "Autoscale the tracking API on CPU",
  "oneLine": "Add a HorizontalPodAutoscaler that keeps the tracking API between 3 and 8 replicas at 70 percent average CPU utilisation and confirm it reads metrics.",
  "minutes": 15,
  "skills": [
   "k8s.workloads.autoscaling"
  ],
  "difficulty": "medium"
 },
 "xpe-net-depot-route": {
  "title": "Reach the depot subnet from the harbour cluster",
  "oneLine": "Add OSPF adjacency between router qm-edge-1 and the depot router so the harbour cluster nodes reach 10.40.8.0/24, and the depot scanners reach the tracking Ingress address.",
  "minutes": 20,
  "skills": [
   "net.routing.ospf",
   "net.routing.static"
  ],
  "difficulty": "medium"
 },
 "xpe-net-edge-nat": {
  "title": "Give the harbour subnet controlled egress",
  "oneLine": "Configure source NAT on the Linux edge router so only the harbour node subnet reaches the upstream mirror network, with forwarding from every other subnet dropped.",
  "minutes": 20,
  "skills": [
   "net.services.nat",
   "linux.net.firewall"
  ],
  "difficulty": "medium"
 },
 "xpe-sec-restricted-namespace": {
  "title": "Enforce the restricted profile on the tracking namespace",
  "oneLine": "Label the tracking namespace to enforce the restricted Pod Security Standard and change the Deployment so its Pods still start: non-root, no privilege escalation, all capabilities dropped, RuntimeDefault seccomp.",
  "minutes": 15,
  "skills": [
   "k8s.security.pod-security-admission",
   "k8s.security.security-context"
  ],
  "difficulty": "medium"
 },
 "xpe-sec-least-privilege-ci": {
  "title": "Cut the CI service account down to what it uses",
  "oneLine": "The ci-deployer ServiceAccount holds cluster-admin; replace that with a namespaced Role that only lets it update Deployments and read Pods in the tracking namespace, and disable token automounting for other Pods.",
  "minutes": 15,
  "skills": [
   "k8s.security.rbac-least-privilege",
   "k8s.security.sa-token-hygiene"
  ],
  "difficulty": "medium"
 },
 "xpe-incident-tracking-outage": {
  "title": "Restore the tracking service and write the timeline",
  "oneLine": "Customers see 503s from track.quillmoor.example; restore service end to end and record the root cause and the fixing change in /home/learner/incident/summary.txt in the given three-line format.",
  "minutes": 30,
  "skills": [
   "k8s.troubleshooting.networking",
   "k8s.troubleshooting.events",
   "k8s.troubleshooting.logs"
  ],
  "difficulty": "hard"
 },
 "xpe-incident-disk-pressure": {
  "title": "Clear disk pressure on a build host and prevent recurrence",
  "oneLine": "qm-build-1 rejects new jobs because /var is full; free the space held by runaway logs, add a logrotate policy that keeps 7 compressed days, and record the cause in /home/learner/incident/disk.txt.",
  "minutes": 20,
  "skills": [
   "linux.shell.text-processing",
   "linux.systemd.journal"
  ],
  "difficulty": "medium"
 }
};
