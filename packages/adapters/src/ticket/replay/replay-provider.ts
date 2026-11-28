/**
 * ReplayTaskProvider — the test double for TaskProvider.
 *
 * Mirrors ReplayProvider for AgentProvider: constructor takes a script, each
 * call pops the next entry and returns it. No network, no filesystem, no
 * credentials, no clock, no quota. Fully deterministic; tests run in <5ms.
 *
 * Capabilities default to ['pull'], which wires `fetch` and leaves `ingest`
 * undefined. Passing `capabilities: new Set(['push'])` wires `ingest` and
 * leaves `fetch` undefined. Both-ways tests pass both.
 *
 * Uses: engine tests that need a source but don't care which; integration
 * tests that exercise the upsert + rate-limit loop against a scripted stream;
 * UI tests of the import progress view against a known pagination length.
 *
 * See docs/superpowers/specs/2026-11-14-task-source-port-design.md.
 */

import type {
  SourceCapability,
  SourceId,
  SourceInput,
  SourceResult,
  TaskProvider,
} from '@lamproom/core';

export interface ReplayTaskProviderOptions {
  script: SourceResult[];
  capabilities?: Set<SourceCapability>;
}

export class ReplayTaskProvider implements TaskProvider {
  readonly id: SourceId = 'replay';
  readonly capabilities: ReadonlySet<SourceCapability>;
  private readonly script: SourceResult[];
  private index = 0;

  readonly fetch?: (input: SourceInput) => Promise<SourceResult>;
  readonly ingest?: (event: Buffer, headers: Record<string, string>) => Promise<SourceResult>;

  constructor(opts: ReplayTaskProviderOptions) {
    this.script = [...opts.script];
    this.capabilities = opts.capabilities ?? new Set<SourceCapability>(['pull']);

    if (this.capabilities.has('pull')) {
      this.fetch = async (_input) => this.nextResult();
    }
    if (this.capabilities.has('push')) {
      this.ingest = async (_event, _headers) => this.nextResult();
    }
  }

  private nextResult(): SourceResult {
    if (this.index >= this.script.length) {
      throw new Error(`ReplayTaskProvider: script exhausted after ${this.index} calls`);
    }
    return this.script[this.index++]!;
  }
}
