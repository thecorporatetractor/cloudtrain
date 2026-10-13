import type { Terminal } from '@xterm/xterm';
import type { AccessKind, Lab, TopologyLink, TopologyNode } from '@/api/types';

/**
 * Dev-only in-browser shell so the workspace UX is demonstrable without a terminal gateway.
 * It echoes input, keeps history, and answers a handful of commands with plausible output
 * derived from the lab topology. It is not a real shell and never will be; the real one
 * speaks to services/terminal-gateway over WebSocket.
 */

const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';
const UNDER = '\x1b[4m';

interface Host {
  name: string;
  user: string;
  kind: 'jumphost' | 'linux' | 'cp' | 'netdev';
  configMode?: boolean;
}

export interface FakeShellOptions {
  lab: Lab;
  node: TopologyNode;
  access: AccessKind;
  /** Called when the user runs a command that should open another node's console. */
  onOpenNode?: (name: string) => void;
}

const pad = (s: string, n: number) => s.padEnd(n);

export class FakeShell {
  private line = '';
  private cursor = 0;
  private history: string[] = [];
  private histIdx = -1;
  private stack: Host[] = [];
  private context: string;
  private cwd = '~';
  private usedContexts = new Set<string>();
  private busy: { cancel: () => void } | null = null;
  private disposed = false;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private term: Terminal,
    private opts: FakeShellOptions,
  ) {
    const clusters = opts.lab.spec.topology.nodes.filter((n) => n.driver === 'k8s-cluster');
    this.context = clusters[0]?.cluster?.context ?? 'default';
    this.usedContexts.add(this.context);
    this.stack.push(this.hostFor(opts.node, opts.access));
  }

  private hostFor(node: TopologyNode, access: AccessKind): Host {
    const entry = this.opts.lab.spec.topology.entry;
    if (node.name === entry) return { name: node.name, user: 'learner', kind: 'jumphost' };
    if (node.driver === 'netdev') return { name: node.name, user: '', kind: 'netdev' };
    if (node.driver === 'k8s-cluster') {
      const cp = node.cluster?.nodes?.find((n) => n.role === 'control-plane')?.name ?? `${node.name}-cp-1`;
      return { name: cp, user: 'root', kind: 'cp' };
    }
    return { name: node.name, user: access === 'console' ? 'root' : 'learner', kind: 'linux' };
  }

  get host(): Host {
    return this.stack[this.stack.length - 1]!;
  }

  start() {
    const h = this.host;
    const t = this.term;
    if (h.kind === 'jumphost') {
      t.writeln(`${DIM}CloudTrain lab session · ${this.opts.lab.metadata.id} · ${this.opts.access}${RESET}`);
      t.writeln(`${DIM}kubeconfig: ~/.kube/config (context ${this.context}) · ssh config: ~/.ssh/config · type ${RESET}help${DIM} for the demo shell${RESET}`);
    } else if (h.kind === 'netdev') {
      t.writeln(`${DIM}Connected to ${h.name} console (FRRouting 10.1)${RESET}`);
    } else {
      t.writeln(`${DIM}Welcome to ${h.name} (${this.opts.node.image ?? 'linux'}) via ${this.opts.access}${RESET}`);
    }
    t.writeln('');
    this.prompt();
    this.disposables.push(t.onData((d) => this.onData(d)));
  }

  dispose() {
    this.disposed = true;
    this.busy?.cancel();
    this.disposables.forEach((d) => d.dispose());
  }

  private promptText(): string {
    const h = this.host;
    if (h.kind === 'netdev') return `${BOLD}${h.name}${h.configMode ? '(config)' : ''}#${RESET} `;
    const cwd = h.kind === 'jumphost' ? this.cwd : '~';
    const sym = h.user === 'root' ? '#' : '$';
    return `${BOLD}${h.user}@${h.name}${RESET}${DIM}:${cwd}${RESET}${sym} `;
  }

  private prompt() {
    this.term.write(this.promptText());
  }

  private redraw() {
    const t = this.term;
    t.write('\r\x1b[K' + this.promptText() + this.line);
    const back = this.line.length - this.cursor;
    if (back > 0) t.write(`\x1b[${back}D`);
  }

  private onData(d: string) {
    if (this.disposed) return;
    if (this.busy) {
      if (d === '\x03') {
        this.busy.cancel();
        this.busy = null;
        this.term.writeln('^C');
        this.prompt();
      }
      return;
    }
    for (const ch of splitInput(d)) this.handleKey(ch);
  }

  private handleKey(ch: string) {
    const t = this.term;
    switch (ch) {
      case '\r':
        t.writeln('');
        this.exec(this.line);
        return;
      case '\x7f': // backspace
        if (this.cursor > 0) {
          this.line = this.line.slice(0, this.cursor - 1) + this.line.slice(this.cursor);
          this.cursor--;
          this.redraw();
        }
        return;
      case '\x03': // ctrl+c
        t.writeln('^C');
        this.line = '';
        this.cursor = 0;
        this.prompt();
        return;
      case '\x0c': // ctrl+l
        t.clear();
        this.redraw();
        return;
      case '\x15': // ctrl+u
        this.line = this.line.slice(this.cursor);
        this.cursor = 0;
        this.redraw();
        return;
      case '\x01':
        this.cursor = 0;
        this.redraw();
        return;
      case '\x05':
        this.cursor = this.line.length;
        this.redraw();
        return;
      case '\x1b[A':
        if (this.history.length) {
          this.histIdx = this.histIdx < 0 ? this.history.length - 1 : Math.max(0, this.histIdx - 1);
          this.line = this.history[this.histIdx] ?? '';
          this.cursor = this.line.length;
          this.redraw();
        }
        return;
      case '\x1b[B':
        if (this.histIdx >= 0) {
          this.histIdx = this.histIdx + 1 >= this.history.length ? -1 : this.histIdx + 1;
          this.line = this.histIdx < 0 ? '' : (this.history[this.histIdx] ?? '');
          this.cursor = this.line.length;
          this.redraw();
        }
        return;
      case '\x1b[C':
        if (this.cursor < this.line.length) {
          this.cursor++;
          t.write('\x1b[C');
        }
        return;
      case '\x1b[D':
        if (this.cursor > 0) {
          this.cursor--;
          t.write('\x1b[D');
        }
        return;
      case '\t': {
        const completed = this.complete(this.line);
        if (completed !== null) {
          this.line = completed;
          this.cursor = this.line.length;
          this.redraw();
        }
        return;
      }
      default:
        if (ch.length === 1 && ch >= ' ') {
          this.line = this.line.slice(0, this.cursor) + ch + this.line.slice(this.cursor);
          this.cursor++;
          this.redraw();
        }
    }
  }

  private complete(line: string): string | null {
    const words = ['kubectl ', 'kubectl get ', 'kubectl config ', 'kubectl apply -f ', 'kubectl auth can-i ', 'ssh ', 'systemctl status ', 'show ip ospf neighbor', 'show ip route', 'show running-config', 'configure terminal', 'history', 'help', 'clear', 'exit'];
    const hits = words.filter((w) => w.startsWith(line) && w !== line);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) {
      this.term.writeln('');
      this.term.writeln(hits.map((h) => h.trim()).join('  '));
      this.redraw();
    }
    return null;
  }

  private println(s = '') {
    this.term.writeln(s);
  }

  private finish() {
    this.line = '';
    this.cursor = 0;
    this.histIdx = -1;
    this.prompt();
  }

  private exec(raw: string) {
    const cmd = raw.trim();
    if (cmd) this.history.push(cmd);
    if (!cmd) return this.finish();
    const [head, ...rest] = cmd.replace(/^sudo\s+/, '').split(/\s+/);
    const h = this.host;
    if (h.kind === 'netdev') {
      this.execNetdev(cmd);
      return this.finish();
    }
    switch (head) {
      case 'help':
        this.printHelp();
        break;
      case 'clear':
        this.term.clear();
        break;
      case 'history':
        this.history.forEach((c, i) => this.println(`${String(i + 1).padStart(4)}  ${c}`));
        break;
      case 'pwd':
        this.println(this.cwd === '~' ? `/home/${h.user}` : this.cwd);
        break;
      case 'cd':
        this.cwd = rest[0] && rest[0] !== '~' ? (rest[0].startsWith('/') ? rest[0] : `~/${rest[0]}`) : '~';
        break;
      case 'whoami':
        this.println(h.user);
        break;
      case 'hostname':
        this.println(h.name);
        break;
      case 'date':
        this.println(new Date().toString());
        break;
      case 'uname':
        this.println(rest.includes('-a') ? `Linux ${h.name} 6.8.0-45-generic #45-Ubuntu SMP x86_64 GNU/Linux` : 'Linux');
        break;
      case 'echo':
        this.println(rest.join(' ').replace(/^["']|["']$/g, ''));
        break;
      case 'ls':
        this.ls(rest);
        break;
      case 'cat':
        this.cat(rest[0]);
        break;
      case 'exit':
      case 'logout':
        if (this.stack.length > 1) {
          this.stack.pop();
          this.println(`${DIM}Connection to ${h.name} closed.${RESET}`);
        } else {
          this.println(`${DIM}This is the lab jumphost; close the tab to end the console.${RESET}`);
        }
        break;
      case 'ssh':
        this.ssh(rest.filter((a) => !a.startsWith('-')).pop());
        break;
      case 'kubectl':
      case 'k':
        this.kubectl(rest);
        break;
      case 'ping':
        return this.ping(rest.filter((a) => !a.startsWith('-')).pop() ?? '');
      case 'ip':
        this.ip(rest[0]);
        break;
      case 'df':
        this.println('Filesystem                     Size  Used Avail Use% Mounted on');
        this.println('/dev/mapper/vg_root-lv_root     20G  6.1G   13G  32% /');
        if (h.name === 'quill-db') this.println('/dev/mapper/vg_data-lv_postgres 18G   17G  720M  96% /var/lib/postgres');
        break;
      case 'lsblk':
        this.println('NAME                     MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS');
        this.println('vda                      253:0    0   20G  0 disk');
        this.println('└─vda1                   253:1    0   20G  0 part /');
        if (h.name === 'quill-db') {
          this.println('vdb                      253:16   0   18G  0 disk');
          this.println('└─vg_data-lv_postgres    252:0    0   18G  0 lvm  /var/lib/postgres');
          this.println('vdc                      253:32   0    8G  0 disk');
        }
        break;
      case 'vgs':
        this.println('  VG      #PV #LV #SN Attr   VSize   VFree');
        this.println('  vg_data   1   1   0 wz--n- <18.00g    0');
        break;
      case 'lvs':
        this.println('  LV          VG      Attr       LSize');
        this.println('  lv_postgres vg_data -wi-ao---- <18.00g');
        break;
      case 'pvs':
        this.println('  PV         VG      Fmt  Attr PSize   PFree');
        this.println('  /dev/vdb   vg_data lvm2 a--  <18.00g    0');
        break;
      case 'systemctl':
        this.systemctl(rest);
        break;
      case 'sshd':
        if (rest.includes('-T')) {
          this.println('port 22');
          this.println('passwordauthentication yes');
          this.println('permitrootlogin prohibit-password');
          this.println('pubkeyauthentication yes');
        } else this.println('sshd: no hostkeys available -- exiting.');
        break;
      case 'tcpdump':
        this.println(`${DIM}tip: right-click a link on the topology canvas and choose “Capture” to open a live capture tab.${RESET}`);
        break;
      case 'vtysh':
        this.println(`${DIM}vtysh is only present on network devices; open a device console from the topology.${RESET}`);
        break;
      case 'vim':
      case 'vi':
      case 'nano':
        this.println(`${DIM}${head}: editors are not emulated in the demo shell. In a real session this opens ${rest[0] ?? 'a file'}.${RESET}`);
        break;
      default:
        this.println(`${head}: command not found`);
    }
    this.finish();
  }

  private printHelp() {
    const rows: [string, string][] = [
      ['kubectl get nodes|pods|ns|netpol|svc', 'inspect the current cluster context'],
      ['kubectl config get-contexts | use-context <name>', 'switch between lab clusters'],
      ['kubectl auth can-i <verb> <resource> --as <user>', 'RBAC checks'],
      ['ssh <node>', 'hop to another node in the topology'],
      ['ls, cat, pwd, cd, echo, history, clear', 'the usual'],
      ['ping <node>', 'reachability (Ctrl+C to stop)'],
      ['exit', 'leave an ssh hop'],
    ];
    this.println(`${BOLD}Demo shell${RESET} ${DIM}— a fake, in-browser shell for UX previews. Real labs run a real shell.${RESET}`);
    rows.forEach(([c, d]) => this.println(`  ${pad(c, 50)}${DIM}${d}${RESET}`));
  }

  private ls(args: string[]) {
    const long = args.includes('-l') || args.includes('-la');
    const target = args.find((a) => !a.startsWith('-'));
    const files: Record<string, [string, string][]> = {
      '~': [
        ['manifests/', 'drwxr-xr-x'],
        ['notes.md', '-rw-r--r--'],
        ['probes.yaml', '-rw-r--r--'],
        ['README', '-rw-r--r--'],
      ],
      manifests: [
        ['default-deny.yaml', '-rw-r--r--'],
        ['allow-checkout.yaml', '-rw-r--r--'],
      ],
    };
    const key = target?.replace(/^~\//, '').replace(/\/$/, '') || (this.cwd === '~' ? '~' : this.cwd.replace(/^~\//, ''));
    const list = files[key];
    if (!list) return this.println(`ls: cannot access '${target}': No such file or directory`);
    if (long) list.forEach(([n, m]) => this.println(`${m} 1 learner learner ${String(n.length * 97).padStart(5)} Oct 12 09:${String(10 + n.length).padStart(2, '0')} ${n}`));
    else this.println(list.map(([n]) => n).join('  '));
  }

  private cat(file?: string) {
    if (!file) return this.println('cat: missing operand');
    const f = file.replace(/^~\//, '');
    if (f === 'README') {
      this.println(`${this.opts.lab.metadata.title}`);
      this.println('');
      this.println(this.opts.lab.spec.description.replace(/[`*]/g, '').split('\n')[0] ?? '');
      this.println('');
      this.println(`Checks: ${this.opts.lab.spec.checks.map((c) => c.id).join(', ')}`);
    } else if (f === 'notes.md') {
      this.println('# notes');
      this.println('- contexts: ' + this.clusterContexts().join(', '));
      this.println('- entry node: ' + (this.opts.lab.spec.topology.entry ?? 'workstation'));
    } else if (f === 'probes.yaml') {
      this.println('apiVersion: v1');
      this.println('kind: Pod');
      this.println('metadata: { name: probe, namespace: checkout, labels: { app: probe } }');
      this.println('spec:');
      this.println('  containers: [{ name: probe, image: registry.tessera.internal/netshoot:1, command: [sleep, infinity] }]');
    } else if (f.startsWith('manifests/')) {
      this.println('apiVersion: networking.k8s.io/v1');
      this.println('kind: NetworkPolicy');
      this.println(`metadata: { name: ${f.replace('manifests/', '').replace('.yaml', '')}, namespace: payments }`);
      this.println('spec: { podSelector: {}, policyTypes: [Ingress] }');
    } else this.println(`cat: ${file}: No such file or directory`);
  }

  private clusterContexts(): string[] {
    return this.opts.lab.spec.topology.nodes.filter((n) => n.driver === 'k8s-cluster').map((n) => n.cluster?.context ?? n.name);
  }

  private ssh(target?: string) {
    if (!target) return this.println('usage: ssh [user@]host');
    const name = target.split('@').pop()!;
    const topo = this.opts.lab.spec.topology;
    const node = topo.nodes.find((n) => n.name === name);
    const clusterNode = topo.nodes.find((n) => n.cluster?.nodes?.some((c) => c.name === name));
    if (node?.driver === 'netdev') {
      this.println(`${DIM}Opening device console for ${name}…${RESET}`);
      this.opts.onOpenNode?.(name);
      return;
    }
    if (clusterNode) {
      this.println(`${DIM}Warning: Permanently added '${name}' (ED25519) to the list of known hosts.${RESET}`);
      this.stack.push({ name, user: 'root', kind: 'cp' });
      return;
    }
    if (node && node.name !== topo.entry) {
      this.println(`${DIM}Warning: Permanently added '${name}' (ED25519) to the list of known hosts.${RESET}`);
      this.stack.push({ name, user: node.driver === 'k8s-cluster' ? 'root' : 'learner', kind: node.driver === 'k8s-cluster' ? 'cp' : 'linux' });
      return;
    }
    this.println(`ssh: Could not resolve hostname ${name}: Name or service not known`);
  }

  private currentCluster(): TopologyNode | undefined {
    return this.opts.lab.spec.topology.nodes.find((n) => n.driver === 'k8s-cluster' && (n.cluster?.context ?? n.name) === this.context);
  }

  private kubectl(args: string[]) {
    const [verb, ...rest] = args;
    const cluster = this.currentCluster();
    if (!cluster) return this.println('The connection to the server localhost:8080 was refused - did you specify the right host or port?');
    const nsIdx = rest.indexOf('-n');
    const ns = nsIdx >= 0 ? rest[nsIdx + 1] : 'default';
    const all = rest.includes('-A') || rest.includes('--all-namespaces');
    const wide = rest.includes('-o') && rest[rest.indexOf('-o') + 1] === 'wide';
    const ctxTag = `${DIM}[${this.context}]${RESET}`;
    switch (verb) {
      case 'version':
        this.println(`Client Version: v1.35.0`);
        this.println(`Server Version: v${cluster.cluster?.version ?? '1.35.1'}`);
        return;
      case 'config': {
        const [sub, name] = rest;
        if (sub === 'get-contexts') {
          this.println('CURRENT   NAME       CLUSTER    AUTHINFO            NAMESPACE');
          this.clusterContexts().forEach((c) => this.println(`${pad(c === this.context ? '*' : '', 10)}${pad(c, 11)}${pad(c, 11)}${pad(`learner@${c}`, 20)}default`));
        } else if (sub === 'use-context') {
          if (name && this.clusterContexts().includes(name)) {
            this.context = name;
            this.usedContexts.add(name);
            this.println(`Switched to context "${name}".`);
          } else this.println(`error: no context exists with the name: "${name ?? ''}"`);
        } else if (sub === 'current-context') this.println(this.context);
        else this.println('error: unknown command');
        return;
      }
      case 'auth': {
        const canI = rest[0] === 'can-i';
        if (!canI) return this.println('error: unknown command');
        const v = rest[1];
        const res = rest[2];
        const as = rest.includes('--as') ? rest[rest.indexOf('--as') + 1] : null;
        const yes = !as || /admin/.test(as) || (v === 'list' && res === 'pods');
        this.println(yes ? 'yes' : 'no');
        return;
      }
      case 'apply': {
        const f = rest.includes('-f') ? rest[rest.indexOf('-f') + 1] : undefined;
        if (!f) return this.println('error: must specify one of -f and -k');
        const n = f.split('/').pop()!.replace(/\.ya?ml$/, '');
        this.println(`networkpolicy.networking.k8s.io/${n} created`);
        return;
      }
      case 'describe':
        this.println(`Name:         ${rest[1] ?? ''}`);
        this.println(`Namespace:    ${ns}`);
        this.println(`Labels:       <none>`);
        this.println(`Events:       <none>`);
        return;
      case 'get': {
        const res = (rest[0] ?? '').toLowerCase();
        const nodes = cluster.cluster?.nodes ?? [{ name: `${cluster.name}-cp-1`, role: 'control-plane' as const }];
        if (/^(no|node|nodes)$/.test(res)) {
          this.println(ctxTag);
          this.println(wide ? pad('NAME', 16) + pad('STATUS', 10) + pad('ROLES', 16) + pad('AGE', 6) + pad('VERSION', 10) + pad('INTERNAL-IP', 14) + 'OS-IMAGE' : pad('NAME', 16) + pad('STATUS', 10) + pad('ROLES', 16) + pad('AGE', 6) + 'VERSION');
          nodes.forEach((n, i) => {
            const base = pad(n.name, 16) + pad(n.state === 'notready' ? 'NotReady' : 'Ready', 10) + pad(n.role === 'control-plane' ? 'control-plane' : '<none>', 16) + pad(`${12 + i}d`, 6) + pad(`v${cluster.cluster?.version ?? '1.35.1'}`, 10);
            this.println(wide ? base + pad(`10.40.0.${11 + i}`, 14) + 'Ubuntu 24.04.1 LTS' : base.trimEnd());
          });
          return;
        }
        if (/^(ns|namespace|namespaces)$/.test(res)) {
          this.println(ctxTag);
          this.println(pad('NAME', 20) + pad('STATUS', 10) + 'AGE');
          ['default', 'kube-system', 'kube-public', 'kube-node-lease', 'payments', 'checkout', 'inventory', 'fleet-ops', 'tenant-a', 'tenant-b'].forEach((n, i) => this.println(pad(n, 20) + pad('Active', 10) + `${30 - i}d`));
          return;
        }
        if (/^(po|pod|pods)$/.test(res)) {
          this.println(ctxTag);
          const rows: [string, string, string, string][] = all
            ? [
                ['kube-system', 'coredns-7db6d8ff4d-9xk2p', '1/1', 'Running'],
                ['kube-system', 'etcd-' + nodes[0]!.name, '1/1', 'Running'],
                ['kube-system', 'kube-apiserver-' + nodes[0]!.name, '1/1', 'Running'],
                ['payments', 'settlement-api-6c9b7d8f5-tq2lm', '1/1', 'Running'],
                ['payments', 'settlement-api-6c9b7d8f5-z8vxn', '1/1', 'Running'],
                ['checkout', 'probe', '1/1', 'Running'],
                ['inventory', 'probe', '1/1', 'Running'],
              ]
            : ns === 'payments'
              ? [
                  ['payments', 'settlement-api-6c9b7d8f5-tq2lm', '1/1', 'Running'],
                  ['payments', 'settlement-api-6c9b7d8f5-z8vxn', '1/1', 'Running'],
                ]
              : ns === 'default'
                ? []
                : [[ns!, 'probe', '1/1', 'Running']];
          if (!rows.length) return this.println(`No resources found in ${ns} namespace.`);
          this.println((all ? pad('NAMESPACE', 14) : '') + pad('NAME', 36) + pad('READY', 8) + pad('STATUS', 10) + pad('RESTARTS', 10) + 'AGE');
          rows.forEach(([n, p, r, s], i) => this.println((all ? pad(n, 14) : '') + pad(p, 36) + pad(r, 8) + pad(s, 10) + pad(String(i % 2), 10) + `${3 + i}h`));
          return;
        }
        if (/^(netpol|networkpolicy|networkpolicies)$/.test(res)) {
          this.println(ctxTag);
          if (ns !== 'payments' && !all) return this.println(`No resources found in ${ns} namespace.`);
          this.println(pad('NAME', 24) + pad('POD-SELECTOR', 16) + 'AGE');
          this.println(pad('allow-all-legacy', 24) + pad('<none>', 16) + '41d');
          return;
        }
        if (/^(svc|service|services)$/.test(res)) {
          this.println(ctxTag);
          this.println(pad('NAME', 20) + pad('TYPE', 12) + pad('CLUSTER-IP', 16) + pad('PORT(S)', 12) + 'AGE');
          if (ns === 'payments' || all) this.println(pad('settlement-api', 20) + pad('ClusterIP', 12) + pad('10.96.112.40', 16) + pad('8443/TCP', 12) + '41d');
          else this.println(pad('kubernetes', 20) + pad('ClusterIP', 12) + pad('10.96.0.1', 16) + pad('443/TCP', 12) + '41d');
          return;
        }
        if (/^(deploy|deployment|deployments)$/.test(res)) {
          this.println(ctxTag);
          this.println(pad('NAME', 20) + pad('READY', 8) + pad('UP-TO-DATE', 12) + pad('AVAILABLE', 11) + 'AGE');
          this.println(pad(ns === 'payments' ? 'settlement-api' : 'dispatch', 20) + pad('2/2', 8) + pad('2', 12) + pad('2', 11) + '41d');
          return;
        }
        if (/^(sa|serviceaccount|serviceaccounts)$/.test(res)) {
          this.println(pad('NAME', 16) + pad('SECRETS', 9) + 'AGE');
          this.println(pad('default', 16) + pad('0', 9) + '41d');
          this.println(pad('deploy-bot', 16) + pad('0', 9) + '12d');
          return;
        }
        if (/^(clusterrolebinding|clusterrolebindings|crb)$/.test(res)) {
          this.println(pad('NAME', 36) + pad('ROLE', 32) + 'AGE');
          this.println(pad('cluster-admin', 36) + pad('ClusterRole/cluster-admin', 32) + '41d');
          this.println(pad('deploy-bot-admin', 36) + pad('ClusterRole/cluster-admin', 32) + '12d');
          return;
        }
        this.println(`error: the server doesn't have a resource type "${rest[0] ?? ''}"`);
        return;
      }
      case undefined:
        this.println('kubectl controls the Kubernetes cluster manager.');
        this.println('');
        this.println(' Basic commands: get, describe, apply, config, auth');
        return;
      default:
        this.println(`error: unknown command "${verb}" for "kubectl"`);
    }
  }

  private systemctl(args: string[]) {
    const [sub, unit] = args;
    if (sub === 'status') {
      const u = unit ?? 'harbor-sync.service';
      this.println(`● ${u} - ${u.replace('.service', '')} daemon`);
      this.println(`     Loaded: loaded (/etc/systemd/system/${u}; enabled)`);
      this.println(`     Active: ${BOLD}active (running)${RESET} since Mon 2026-10-12 08:14:02 UTC; 1 day 3h ago`);
      this.println(`   Main PID: 1187 (${u.replace('.service', '')})`);
      this.println(`      Tasks: 3 (limit: 2317)`);
      this.println(`     Memory: 14.2M`);
    } else if (sub === 'cat') {
      this.println(`# /etc/systemd/system/${unit ?? 'harbor-sync.service'}`);
      this.println('[Unit]');
      this.println('Description=harbor-sync daemon');
      this.println('[Service]');
      this.println('ExecStart=/usr/local/bin/harbor-sync --interval 30s');
      this.println('[Install]');
      this.println('WantedBy=multi-user.target');
    } else if (sub === 'list-timers') {
      this.println('NEXT                        LEFT     LAST                        PASSED  UNIT                 ACTIVATES');
      this.println('Tue 2026-10-14 02:30:00 UTC 9h left  Mon 2026-10-13 02:30:00 UTC 14h ago ship-logs.timer      ship-logs.service');
    } else if (['restart', 'reload', 'daemon-reload', 'enable', 'start', 'stop'].includes(sub ?? '')) {
      /* silent success */
    } else this.println('Unknown command verb ' + (sub ?? ''));
  }

  private ip(sub?: string) {
    if (sub === 'a' || sub === 'addr') {
      this.println('1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 state UNKNOWN');
      this.println('    inet 127.0.0.1/8 scope host lo');
      this.println('2: eth0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 state UP');
      this.println(`    inet 10.40.0.10/24 brd 10.40.0.255 scope global eth0`);
    } else if (sub === 'r' || sub === 'route') {
      this.println('default via 10.40.0.1 dev eth0');
      this.println('10.40.0.0/24 dev eth0 proto kernel scope link src 10.40.0.10');
    } else this.println('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }');
  }

  private ping(target: string) {
    if (!target) {
      this.println('ping: usage error: Destination address required');
      return this.finish();
    }
    const topo = this.opts.lab.spec.topology;
    const known = topo.nodes.some((n) => n.name === target || n.cluster?.nodes?.some((c) => c.name === target)) || /^\d+\.\d+\.\d+\.\d+$/.test(target);
    if (!known) {
      this.println(`ping: ${target}: Name or service not known`);
      return this.finish();
    }
    const ip = /^\d/.test(target) ? target : `10.${40 + topo.nodes.findIndex((n) => n.name === target)}.0.10`;
    this.println(`PING ${target} (${ip}) 56(84) bytes of data.`);
    let seq = 1;
    const unreachable = target === 'depot-host';
    const timer = window.setInterval(() => {
      if (unreachable) this.println(`From 10.60.0.1 icmp_seq=${seq} Destination Host Unreachable`);
      else this.println(`64 bytes from ${ip}: icmp_seq=${seq} ttl=63 time=${(0.3 + Math.random() * 0.4).toFixed(3)} ms`);
      seq++;
    }, 900);
    this.busy = {
      cancel: () => {
        window.clearInterval(timer);
        this.println(`--- ${target} ping statistics ---`);
        this.println(`${seq - 1} packets transmitted, ${unreachable ? 0 : seq - 1} received, ${unreachable ? 100 : 0}% packet loss`);
        this.line = '';
        this.cursor = 0;
      },
    };
  }

  private execNetdev(cmd: string) {
    const h = this.host;
    const c = cmd.replace(/\s+/g, ' ').toLowerCase();
    if (h.configMode) {
      if (c === 'exit' || c === 'end') {
        h.configMode = false;
        return;
      }
      return; // accept config lines silently
    }
    if (c === 'help' || c === '?') {
      this.println('  show ip ospf neighbor | show ip route | show running-config | show interface brief | show vlan brief | configure terminal | ping <host> | exit');
      return;
    }
    if (c === 'configure terminal' || c === 'conf t') {
      h.configMode = true;
      return;
    }
    if (c === 'exit' || c === 'quit') {
      this.println(`${DIM}Use the tab close button to leave the console.${RESET}`);
      return;
    }
    if (c.startsWith('show ip ospf nei')) {
      this.println('');
      this.println(pad('Neighbor ID', 16) + pad('Pri', 5) + pad('State', 18) + pad('Dead Time', 11) + pad('Address', 14) + 'Interface');
      const peers = this.opts.lab.spec.topology.links?.filter((l) => l.a.startsWith(h.name + ':') || l.b.startsWith(h.name + ':')) ?? [];
      peers.forEach((l, i) => {
        const [mine, other] = l.a.startsWith(h.name + ':') ? [l.a, l.b] : [l.b, l.a];
        const peer = other.split(':')[0]!;
        const peerNode = this.opts.lab.spec.topology.nodes.find((n) => n.name === peer);
        if (peerNode?.driver !== 'netdev') return;
        const state = i === 0 ? 'Full/DR' : 'Init/DROther';
        this.println(pad(`10.60.255.${i + 2}`, 16) + pad('1', 5) + pad(state, 18) + pad(`${30 + i * 3}.${i}s`, 11) + pad(`10.60.${i + 1}.2`, 14) + `${mine.split(':')[1]}:10.60.${i + 1}.1`);
      });
      if (!peers.length) this.println(`${DIM}(no OSPF neighbours)${RESET}`);
      return;
    }
    if (c.startsWith('show ip route')) {
      this.println('Codes: K - kernel route, C - connected, S - static, O - OSPF');
      this.println('');
      const links = this.opts.lab.spec.topology.links?.filter((l) => l.a.startsWith(h.name + ':') || l.b.startsWith(h.name + ':')) ?? [];
      links.forEach((l) => this.println(`C>* ${l.subnet ?? '10.0.0.0/24'} is directly connected, ${(l.a.startsWith(h.name + ':') ? l.a : l.b).split(':')[1]}`));
      this.println('O   10.60.0.0/24 [110/20] via 10.60.1.1, eth0, weight 1, 00:12:04');
      return;
    }
    if (c.startsWith('show run')) {
      this.println('frr version 10.1');
      this.println(`hostname ${h.name}`);
      this.println('!');
      this.println('router ospf');
      this.println(' ospf router-id 10.60.255.1');
      this.println(' network 10.60.1.0/30 area 0');
      this.println('!');
      this.println('end');
      return;
    }
    if (c.startsWith('show int')) {
      this.println(pad('Interface', 10) + pad('Status', 8) + pad('VRF', 10) + 'Addresses');
      const links = this.opts.lab.spec.topology.links?.filter((l) => l.a.startsWith(h.name + ':') || l.b.startsWith(h.name + ':')) ?? [];
      links.forEach((l, i) => this.println(pad((l.a.startsWith(h.name + ':') ? l.a : l.b).split(':')[1]!, 10) + pad('up', 8) + pad('default', 10) + (l.subnet ?? '').replace(/0\/(\d+)$/, `${i + 1}/$1`)));
      return;
    }
    if (c.startsWith('show vlan')) {
      this.println('VLAN Name                             Status    Ports');
      this.println('---- -------------------------------- --------- -------------------------------');
      this.println('1    default                          active    eth0, eth1, eth2');
      return;
    }
    if (c.startsWith('ping')) {
      this.println('PING 10.60.1.2 (10.60.1.2) 56(84) bytes of data.');
      this.println('64 bytes from 10.60.1.2: icmp_seq=1 ttl=64 time=0.412 ms');
      this.println('64 bytes from 10.60.1.2: icmp_seq=2 ttl=64 time=0.388 ms');
      this.println('--- 10.60.1.2 ping statistics ---');
      this.println('2 packets transmitted, 2 received, 0% packet loss');
      return;
    }
    this.println(`% Unknown command: ${cmd}`);
  }
}

/** Split a chunk of terminal input into individual key events (escape sequences stay intact). */
function splitInput(d: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < d.length) {
    if (d[i] === '\x1b') {
      let j = i + 1;
      if (d[j] === '[') {
        j++;
        while (j < d.length && !/[A-Za-z~]/.test(d[j]!)) j++;
        j++;
      }
      out.push(d.slice(i, j));
      i = j;
    } else {
      out.push(d[i]!);
      i++;
    }
  }
  return out;
}

/** Streams a tcpdump-like capture for a topology link until the user presses Ctrl+C. */
export class FakeCapture {
  private timer: number | null = null;
  private count = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private term: Terminal,
    private link: TopologyLink,
  ) {}

  start() {
    const t = this.term;
    const [a, b] = [this.link.a, this.link.b];
    t.writeln(`${DIM}capture: ${a} ↔ ${b}${this.link.subnet ? ` · ${this.link.subnet}` : ''} · mirrored from the OVN logical switch · Ctrl+C to stop${RESET}`);
    t.writeln(`tcpdump: listening on ${UNDER}ovn-mirror0${RESET}, link-type EN10MB (Ethernet), snapshot length 262144 bytes`);
    const subnet = this.link.subnet?.replace(/\.\d+\/\d+$/, '') ?? '10.40.0';
    const samples = [
      () => `IP ${subnet}.10.49152 > ${subnet}.11.6443: Flags [P.], seq ${rnd(1e6)}:${rnd(1e6)}, ack ${rnd(1e6)}, win 501, length ${rnd(1200)}`,
      () => `IP ${subnet}.11.6443 > ${subnet}.10.49152: Flags [.], ack ${rnd(1e6)}, win 509, length 0`,
      () => `ARP, Request who-has ${subnet}.1 tell ${subnet}.10, length 28`,
      () => `ARP, Reply ${subnet}.1 is-at 0a:58:0a:28:00:01, length 28`,
      () => `IP ${subnet}.10.53421 > ${subnet}.2.53: 41231+ A? kubernetes.default.svc.cluster.local. (54)`,
      () => `IP ${subnet}.2.53 > ${subnet}.10.53421: 41231*- 1/0/0 A 10.96.0.1 (70)`,
      () => `IP ${subnet}.10 > ${subnet}.11: ICMP echo request, id ${rnd(60000)}, seq ${this.count}, length 64`,
      () => `IP ${subnet}.11 > ${subnet}.10: ICMP echo reply, id ${rnd(60000)}, seq ${this.count}, length 64`,
      () => `IP6 fe80::c8a:3bff:fe12:9a01 > ff02::1: ICMP6, router advertisement, length 56`,
    ];
    this.timer = window.setInterval(() => {
      const now = new Date();
      const ts = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}${String(rnd(999)).padStart(3, '0')}`;
      t.writeln(`${DIM}${ts}${RESET} ${samples[rnd(samples.length)]!()}`);
      this.count++;
    }, 260 + Math.random() * 300);
    this.disposables.push(
      t.onData((d) => {
        if (d === '\x03') this.stop();
      }),
    );
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
      this.term.writeln('^C');
      this.term.writeln(`${this.count} packets captured`);
      this.term.writeln(`${this.count} packets received by filter`);
      this.term.writeln('0 packets dropped by kernel');
      this.term.writeln(`${DIM}Capture saved to recordings/${this.link.a.replace(':', '-')}_${this.link.b.replace(':', '-')}.pcap (download available after the session).${RESET}`);
    }
  }

  dispose() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.disposables.forEach((d) => d.dispose());
  }
}

const rnd = (n: number) => Math.floor(Math.random() * n);
