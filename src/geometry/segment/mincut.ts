/**
 * Max-flow / min-cut (Dinic) on a sparse graph with typed storage. Used to snap the SmartCut
 * ring to the cheapest closed boundary (concave creases, seams) inside a band of the mesh.
 */
export class FlowGraph {
  private head: Int32Array;
  private next: number[] = [];
  private to: number[] = [];
  private cap: number[] = [];
  private level: Int32Array;
  private iter: Int32Array;

  constructor(readonly n: number) {
    this.head = new Int32Array(n).fill(-1);
    this.level = new Int32Array(n);
    this.iter = new Int32Array(n);
  }

  /** Edge u → v with capacity `c` and reverse capacity `rc` (undirected: rc = c). */
  addEdge(u: number, v: number, c: number, rc = c) {
    this.to.push(v); this.cap.push(c); this.next.push(this.head[u]); this.head[u] = this.to.length - 1;
    this.to.push(u); this.cap.push(rc); this.next.push(this.head[v]); this.head[v] = this.to.length - 1;
  }

  private bfs(s: number, t: number) {
    const level = this.level;
    level.fill(-1);
    const queue = new Int32Array(this.n);
    let qh = 0, qt = 0;
    level[s] = 0;
    queue[qt++] = s;
    while (qh < qt) {
      const u = queue[qh++];
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        if (this.cap[e] > 1e-12 && level[this.to[e]] < 0) {
          level[this.to[e]] = level[u] + 1;
          queue[qt++] = this.to[e];
        }
      }
    }
    return level[t] >= 0;
  }

  /** Iterative blocking-flow DFS (deep graphs would overflow a recursive one). */
  private dfs(s: number, t: number): number {
    const stack: number[] = [s];
    const edges: number[] = [];
    let total = 0;
    while (stack.length) {
      const u = stack[stack.length - 1];
      if (u === t) {
        let f = Infinity;
        for (const e of edges) f = Math.min(f, this.cap[e]);
        for (const e of edges) {
          this.cap[e] -= f;
          this.cap[e ^ 1] += f;
        }
        total += f;
        // Restart from the first saturated edge.
        let k = 0;
        while (k < edges.length && this.cap[edges[k]] > 1e-12) k++;
        stack.length = k + 1;
        edges.length = k;
        continue;
      }
      let advanced = false;
      for (let e = this.iter[u]; e !== -1; e = this.next[e]) {
        this.iter[u] = e;
        const v = this.to[e];
        if (this.cap[e] > 1e-12 && this.level[v] === this.level[u] + 1) {
          stack.push(v);
          edges.push(e);
          advanced = true;
          break;
        }
      }
      if (!advanced) {
        this.iter[u] = -1;
        this.level[u] = -1; // dead end
        stack.pop();
        edges.pop();
        if (stack.length) {
          const pu = stack[stack.length - 1];
          const e = this.iter[pu];
          if (e !== -1) this.iter[pu] = this.next[e];
        }
      }
    }
    return total;
  }

  maxflow(s: number, t: number) {
    let flow = 0;
    while (this.bfs(s, t)) {
      for (let u = 0; u < this.n; u++) this.iter[u] = this.head[u];
      flow += this.dfs(s, t);
    }
    return flow;
  }

  /** Nodes still reachable from `s` in the residual graph (the source side of the min cut). */
  sourceSide(s: number): Uint8Array {
    const seen = new Uint8Array(this.n);
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]; e !== -1; e = this.next[e]) {
        const v = this.to[e];
        if (!seen[v] && this.cap[e] > 1e-12) {
          seen[v] = 1;
          stack.push(v);
        }
      }
    }
    return seen;
  }
}
