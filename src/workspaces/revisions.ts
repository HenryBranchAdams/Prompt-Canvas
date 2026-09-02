import type { WorkspaceManifest } from './types.js'

export class StaleRevisionError extends Error {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number) {
    super(`Stale workspace revision: expected ${expected}, current revision is ${actual}.`)
    this.name = 'StaleRevisionError'
    this.expected = expected
    this.actual = actual
  }
}

export class StaleGenerationRevisionError extends Error {
  readonly expected: number
  readonly actual: number

  constructor(expected: number, actual: number) {
    super(`Stale generation context: expected ${expected}, current generation revision is ${actual}.`)
    this.name = 'StaleGenerationRevisionError'
    this.expected = expected
    this.actual = actual
  }
}

export function assertDocumentRevision(manifest: WorkspaceManifest, expected: number): void {
  if (manifest.documentRevision !== expected) {
    throw new StaleRevisionError(expected, manifest.documentRevision)
  }
}

export function assertGenerationRevision(manifest: WorkspaceManifest, expected: number): void {
  if (manifest.generationRevision !== expected) {
    throw new StaleGenerationRevisionError(expected, manifest.generationRevision)
  }
}

export function nextRevision(
  manifest: WorkspaceManifest,
  generationRelevant: boolean,
  at = new Date().toISOString(),
): WorkspaceManifest {
  return {
    ...manifest,
    documentRevision: manifest.documentRevision + 1,
    generationRevision: manifest.generationRevision + (generationRelevant ? 1 : 0),
    updatedAt: at,
  }
}
