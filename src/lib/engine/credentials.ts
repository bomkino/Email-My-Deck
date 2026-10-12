/**
 * Content Credentials (C2PA) in a PDF: a signed record of who made the file,
 * with what and when. It is stored as an embedded file whose file specification
 * says `/AFRelationship /C2PA_Manifest`, hung off the catalog's `/AF` (and, by
 * the spec, also listed in the EmbeddedFiles name tree), or off one object's
 * `/AF` for that object alone. InDesign adds one on export.
 *
 * The signature covers the file's exact bytes, so no rewritten copy can keep
 * it: one that did would fail every check as tampered. The engine leaves them
 * out of anything it rewrites and says so; an untouched original keeps them.
 */
import { isDict, isRef, type JsonDict, type JsonValue, type PdfGraph, type QpdfObjectEntry } from './pdfjson'

const MAX_TREE_DEPTH = 32

/** A file specification marked as a C2PA manifest store. */
export function isCredentials(graph: PdfGraph, value: JsonValue | undefined): boolean {
  return graph.name(graph.dict(value)?.['/AFRelationship']) === '/C2PA_Manifest'
}

/**
 * True when every file an EmbeddedFiles name tree lists is Content Credentials
 * (or it lists none). A tree that can't be read to the end counts as holding more.
 */
export function onlyCredentials(graph: PdfGraph, tree: JsonValue | undefined): boolean {
  const seen = new Set<string>()
  const stack: Array<{ node: JsonValue | undefined; depth: number }> = [{ node: tree, depth: 0 }]
  while (stack.length) {
    const { node, depth } = stack.pop()!
    if (isRef(node)) {
      if (seen.has(node)) continue
      seen.add(node)
    }
    const dict = graph.dict(node)
    if (!dict || depth > MAX_TREE_DEPTH) return false
    const names = graph.array(dict['/Names'])
    if (names) {
      for (let index = 1; index < names.length; index += 2) if (!isCredentials(graph, names[index])) return false
    }
    for (const kid of graph.array(dict['/Kids']) ?? []) stack.push({ node: kid, depth: depth + 1 })
  }
  return true
}

export function hasCredentials(graph: PdfGraph): boolean {
  for (const dict of graph.dictionaries()) if (dict['/EF'] !== undefined && isCredentials(graph, dict)) return true
  return false
}

type ObjectUpdate = { value: JsonValue } | { stream: { dict: JsonDict } }

/**
 * Objects to replace (for `qpdf --update-from-json`) so nothing refers to
 * Content Credentials any more: each `/AF` loses its manifests, and an
 * EmbeddedFiles tree that held only manifests goes. QPDF writes only what is
 * still referred to, so the manifests themselves drop out.
 *
 * A stream keeps its data: given a dictionary and no data, QPDF keeps the
 * stream's bytes, so every other key (its filters above all) is copied as is.
 */
export function credentialsUpdate(graph: PdfGraph): Record<string, ObjectUpdate> {
  const updates: Record<string, ObjectUpdate> = {}
  const strip = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) {
      const items = value.map(strip)
      return items.some((item, index) => item !== value[index]) ? items : value
    }
    if (!isDict(value)) return value
    let changed = false
    const dict: JsonDict = {}
    for (const [key, item] of Object.entries(value)) {
      if (key === '/AF') {
        const files = graph.array(item) ?? [item]
        const kept = files.filter((file) => !isCredentials(graph, file))
        if (kept.length === files.length) dict[key] = item
        else {
          changed = true
          if (kept.length) dict[key] = kept
        }
        continue
      }
      if (key === '/EmbeddedFiles' && onlyCredentials(graph, item)) {
        changed = true
        continue
      }
      const next = strip(item)
      if (next !== item) changed = true
      dict[key] = next
    }
    return changed ? dict : value
  }
  for (const [key, entry] of Object.entries(graph.objects) as Array<[string, QpdfObjectEntry]>) {
    if (!key.startsWith('obj:')) continue
    if (entry.stream) {
      const dict = strip(entry.stream.dict)
      if (dict !== entry.stream.dict) updates[key] = { stream: { dict: dict as JsonDict } }
    } else if (entry.value !== undefined) {
      const value = strip(entry.value)
      if (value !== entry.value) updates[key] = { value }
    }
  }
  return updates
}
