import { EngineError, MESSAGES, toEngineError } from './errors'

type EmscriptenFS = {
  writeFile(path: string, data: Uint8Array | string, options?: { canOwn?: boolean }): void
  readFile(path: string): Uint8Array
  unlink(path: string): void
  mkdir(path: string): void
  readdir(path: string): string[]
  stat(path: string): { size: number }
}

export type QpdfModule = {
  callMain(args: string[]): number
  FS: EmscriptenFS
}

export type QpdfModuleFactory = (options: { locateFile: (path: string) => string }) => Promise<QpdfModule>

/** How to obtain the QPDF factory and its wasm URL (bundler in the browser, file path in Node tests). */
export type QpdfLoader = () => Promise<{ factory: QpdfModuleFactory; wasmUrl: string }>

export type QpdfResult = { code: number; stdout: string[]; stderr: string[] }

type Sink = { out: (line: string) => void; err: (line: string) => void }

const MAX_CAPTURED_LINES = 400

/**
 * One QPDF WebAssembly instance with an in-memory filesystem. A job creates
 * one session and drops it at the end, so the wasm heap is freed with it.
 *
 * QPDF exit codes: 0 success, 3 success with warnings (damaged but repaired),
 * 2 failure.
 */
export class QpdfSession {
  private readonly module: QpdfModule
  private readonly sink: Sink
  private broken = false

  private constructor(module: QpdfModule, sink: Sink) {
    this.module = module
    this.sink = sink
  }

  static async create(loader: QpdfLoader): Promise<QpdfSession> {
    const { factory, wasmUrl } = await loader()
    const sink: Sink = { out: () => {}, err: () => {} }
    // This QPDF build binds console.log/console.error for stdout/stderr when the
    // factory runs, so route both through our sink for exactly that moment.
    const originalLog = console.log
    const originalError = console.error
    console.log = (...args: unknown[]) => sink.out(args.map(String).join(' '))
    console.error = (...args: unknown[]) => sink.err(args.map(String).join(' '))
    let pending: Promise<QpdfModule>
    try {
      pending = factory({ locateFile: () => wasmUrl })
    } finally {
      console.log = originalLog
      console.error = originalError
    }
    let module: QpdfModule
    try {
      module = await pending
    } catch (error) {
      throw toEngineError(error)
    }
    const session = new QpdfSession(module, sink)
    for (const dir of ['/work', '/img', '/parts']) session.module.FS.mkdir(dir)
    return session
  }

  run(args: string[], onLine?: (line: string) => void): QpdfResult {
    if (this.broken) throw new EngineError('engine', MESSAGES.engine)
    const stdout: string[] = []
    const stderr: string[] = []
    const keep = (target: string[], line: string) => {
      target.push(line)
      if (target.length > MAX_CAPTURED_LINES) target.shift()
    }
    this.sink.out = (line) => { keep(stdout, line); onLine?.(line) }
    this.sink.err = (line) => { keep(stderr, line); onLine?.(line) }
    try {
      const code = this.module.callMain(args)
      return { code, stdout, stderr }
    } catch (error) {
      // An abort leaves the instance unusable (for example after running out of memory).
      this.broken = true
      throw toEngineError(error)
    } finally {
      this.sink.out = () => {}
      this.sink.err = () => {}
    }
  }

  /**
   * Run QPDF and fail unless it produced a usable result (warnings are allowed).
   * Reading the user's file fails as 'damaged'; a failed rewrite after a clean
   * read is the engine's fault, so callers pass 'engine'.
   */
  runOk(args: string[], onLine?: (line: string) => void, failure: 'damaged' | 'engine' = 'damaged'): QpdfResult {
    const result = this.run(args, onLine)
    if (result.code !== 0 && result.code !== 3) {
      if (failure === 'engine') console.error('QPDF failed', result.stderr.slice(-5).join('\n'))
      throw new EngineError(failure, failure === 'engine' ? MESSAGES.engine : MESSAGES.damaged)
    }
    return result
  }

  /** Run QPDF with a JSON output file and parse it. */
  json<T>(args: string[], outputPath = '/work/out.json'): { result: QpdfResult; data: T | null } {
    const result = this.run([...args, outputPath])
    if (result.code !== 0 && result.code !== 3) return { result, data: null }
    const bytes = this.readFile(outputPath)
    this.remove(outputPath)
    return { result, data: JSON.parse(new TextDecoder().decode(bytes)) as T }
  }

  writeFile(path: string, data: Uint8Array, canOwn = false): void {
    this.module.FS.writeFile(path, data, { canOwn })
  }

  readFile(path: string): Uint8Array {
    return this.module.FS.readFile(path)
  }

  size(path: string): number {
    return this.module.FS.stat(path).size
  }

  remove(path: string): void {
    try {
      this.module.FS.unlink(path)
    } catch {
      // Already gone.
    }
  }

  list(dir: string): string[] {
    return this.module.FS.readdir(dir).filter((name) => name !== '.' && name !== '..')
  }
}
