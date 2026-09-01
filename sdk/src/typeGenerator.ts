// TypeScript type generator for Soroban contract schemas (Issue #192)
//
// Consumes a contract's SCHEMA (spec) entries and emits a `types.ts`-style
// module: interfaces for structs, discriminated unions / string-enums for
// Soroban unions and enums, and a client interface with one method signature
// per contract function.
//
// The spec model below mirrors the JSON produced by
// `soroban contract inspect --output json` / `stellar contract bindings json`
// (a light normalisation of the XDR `ScSpecEntry` set). `fetchContractSchema`
// pulls the same structure from a live network via stellar-sdk.

import { promises as fs } from 'fs';
import * as path from 'path';

// --- Spec model ------------------------------------------------------------

export type SpecPrimitive =
  | 'void'
  | 'bool'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'u128'
  | 'i128'
  | 'u256'
  | 'i256'
  | 'timepoint'
  | 'duration'
  | 'symbol'
  | 'string'
  | 'address'
  | 'bytes'
  | 'error';

export type SpecType =
  | { type: SpecPrimitive }
  | { type: 'bytesN'; n: number }
  | { type: 'option'; value: SpecType }
  | { type: 'vec'; element: SpecType }
  | { type: 'map'; key: SpecType; value: SpecType }
  | { type: 'tuple'; elements: SpecType[] }
  | { type: 'result'; value: SpecType; error: SpecType }
  | { type: 'udt'; name: string };

export interface SpecParam {
  name: string;
  type: SpecType;
  doc?: string;
}

export interface SpecFunction {
  type: 'function';
  name: string;
  doc?: string;
  inputs: SpecParam[];
  outputs: SpecType[];
}

export interface SpecStructField {
  name: string;
  type: SpecType;
  doc?: string;
}

export interface SpecStruct {
  type: 'struct';
  name: string;
  doc?: string;
  fields: SpecStructField[];
}

export interface SpecUnionCase {
  name: string;
  doc?: string;
  /** Present for tuple-variant cases; absent/empty for unit variants. */
  values?: SpecType[];
}

export interface SpecUnion {
  type: 'union';
  name: string;
  doc?: string;
  cases: SpecUnionCase[];
}

export interface SpecEnumCase {
  name: string;
  value: number;
  doc?: string;
}

export interface SpecEnum {
  type: 'enum';
  name: string;
  doc?: string;
  cases: SpecEnumCase[];
}

export interface SpecErrorEnum {
  type: 'error';
  name: string;
  cases: SpecEnumCase[];
}

export type SpecEntry = SpecFunction | SpecStruct | SpecUnion | SpecEnum | SpecErrorEnum;

export interface ContractSchema {
  /** Contract name (used for the generated client interface). */
  name?: string;
  /** Contract id, when known (informational). */
  contractId?: string;
  entries: SpecEntry[];
}

export interface GenerateOptions {
  /** Also emit a `<Name>Client` interface with method signatures. Default true. */
  emitClient?: boolean;
  /** Names of manually-maintained types to diff against (see `manualTypesSource`). */
  manualTypeNames?: string[];
  /** Source of a manual types module; exported names are extracted and diffed. */
  manualTypesSource?: string;
  /** Header banner. Default identifies the file as generated. */
  banner?: string;
}

export interface GenerateResult {
  code: string;
  warnings: string[];
  /** Names of every top-level type the module declares. */
  declaredTypes: string[];
}

// --- Type mapping --------------------------------------------------------

const PRIMITIVE_TS: Record<SpecPrimitive, string> = {
  void: 'void',
  bool: 'boolean',
  u32: 'number',
  i32: 'number',
  u64: 'bigint',
  i64: 'bigint',
  u128: 'bigint',
  i128: 'bigint',
  u256: 'bigint',
  i256: 'bigint',
  timepoint: 'bigint',
  duration: 'bigint',
  symbol: 'string',
  string: 'string',
  address: 'string',
  bytes: 'Buffer | Uint8Array',
  error: 'RWASDKError',
};

/**
 * Convert a Soroban spec type to a TypeScript type expression.
 * Handles Option, Vec, Map, tuples, BytesN, Result and UDT references.
 */
export function specTypeToTs(t: SpecType, referenced?: Set<string>): string {
  switch (t.type) {
    case 'option':
      return `${specTypeToTs(t.value, referenced)} | undefined`;
    case 'vec':
      return `Array<${specTypeToTs(t.element, referenced)}>`;
    case 'map':
      return `Map<${specTypeToTs(t.key, referenced)}, ${specTypeToTs(t.value, referenced)}>`;
    case 'tuple':
      return t.elements.length === 0
        ? 'void'
        : `[${t.elements.map((e) => specTypeToTs(e, referenced)).join(', ')}]`;
    case 'result':
      // The SDK surfaces the ok branch and throws on error.
      return specTypeToTs(t.value, referenced);
    case 'bytesN':
      return 'Buffer | Uint8Array';
    case 'udt':
      referenced?.add(t.name);
      return sanitizeIdentifier(t.name);
    default: {
      const prim = PRIMITIVE_TS[t.type as SpecPrimitive];
      return prim ?? 'unknown';
    }
  }
}

// --- Emitters -----------------------------------------------------------

function docComment(doc: string | undefined, indent = ''): string {
  if (!doc) return '';
  const lines = doc.split('\n').map((l) => `${indent} * ${l}`.trimEnd());
  return `${indent}/**\n${lines.join('\n')}\n${indent} */\n`;
}

function sanitizeIdentifier(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_$]/g, '_');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

function isTupleStruct(s: SpecStruct): boolean {
  return s.fields.length > 0 && s.fields.every((f) => /^\d+$/.test(f.name));
}

function emitStruct(s: SpecStruct, referenced: Set<string>): string {
  const name = sanitizeIdentifier(s.name);
  if (isTupleStruct(s)) {
    const ordered = [...s.fields].sort((a, b) => Number(a.name) - Number(b.name));
    const inner = ordered.map((f) => specTypeToTs(f.type, referenced)).join(', ');
    return `${docComment(s.doc)}export type ${name} = [${inner}];\n`;
  }
  const body = s.fields
    .map((f) => {
      const optional = f.type.type === 'option' ? '?' : '';
      const ts = specTypeToTs(f.type, referenced);
      return `${docComment(f.doc, '  ')}  ${sanitizeIdentifier(f.name)}${optional}: ${ts};`;
    })
    .join('\n');
  return `${docComment(s.doc)}export interface ${name} {\n${body}\n}\n`;
}

function emitUnion(u: SpecUnion, referenced: Set<string>): string {
  const name = sanitizeIdentifier(u.name);
  const members = u.cases.map((c) => {
    const tag = `tag: '${c.name}'`;
    if (!c.values || c.values.length === 0) {
      return `${docComment(c.doc, '  ')}  | { ${tag} }`;
    }
    const values = c.values.map((v) => specTypeToTs(v, referenced)).join(', ');
    return `${docComment(c.doc, '  ')}  | { ${tag}; values: [${values}] }`;
  });
  return `${docComment(u.doc)}export type ${name} =\n${members.join('\n')};\n`;
}

function emitEnum(e: SpecEnum | SpecErrorEnum): string {
  const name = sanitizeIdentifier(e.name);
  const body = e.cases
    .map((c) => `${docComment(c.doc, '  ')}  ${sanitizeIdentifier(c.name)} = ${c.value},`)
    .join('\n');
  return `${docComment((e as SpecEnum).doc)}export enum ${name} {\n${body}\n}\n`;
}

function emitClientInterface(schema: ContractSchema, referenced: Set<string>): string {
  const fns = schema.entries.filter((e): e is SpecFunction => e.type === 'function');
  if (fns.length === 0) return '';
  const clientName = `${sanitizeIdentifier(pascalCase(schema.name || 'Contract'))}Client`;
  const methods = fns
    .map((fn) => {
      const params = fn.inputs
        .map((p) => `${sanitizeIdentifier(p.name)}: ${specTypeToTs(p.type, referenced)}`)
        .join(', ');
      const ret = clientReturnType(fn, referenced);
      return `${docComment(fn.doc, '  ')}  ${sanitizeIdentifier(fn.name)}(${params}): Promise<${ret}>;`;
    })
    .join('\n');
  return `export interface ${clientName} {\n${methods}\n}\n`;
}

function clientReturnType(fn: SpecFunction, referenced: Set<string>): string {
  const outs = fn.outputs.filter((o) => o.type !== 'void');
  if (outs.length === 0) return 'void';
  if (outs.length === 1) return specTypeToTs(outs[0], referenced);
  return `[${outs.map((o) => specTypeToTs(o, referenced)).join(', ')}]`;
}

function pascalCase(s: string): string {
  return s
    .replace(/[_\-\s]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
}

// --- Manual-type diffing ------------------------------------------------

/** Extract exported type/interface/enum names from a TS source string. */
export function extractExportedTypeNames(source: string): string[] {
  const names = new Set<string>();
  const re = /export\s+(?:declare\s+)?(?:interface|type|enum|class)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) names.add(m[1]);
  return [...names];
}

// --- Top-level generation --------------------------------------------

const DEFAULT_BANNER = `// AUTO-GENERATED by \`rwa-sdk generate-types\`. Do not edit by hand.
// Regenerate with: npx rwa-sdk generate-types --contracts <ids>
`;

export function generateTypes(
  schemas: ContractSchema | ContractSchema[],
  options: GenerateOptions = {}
): GenerateResult {
  const list = Array.isArray(schemas) ? schemas : [schemas];
  const warnings: string[] = [];
  const referenced = new Set<string>();
  const declaredTypes: string[] = [];
  const chunks: string[] = [];

  const definedUdts = new Set<string>();
  for (const schema of list) {
    for (const entry of schema.entries) {
      if (entry.type === 'function') continue;
      definedUdts.add(entry.name);
    }
  }

  for (const schema of list) {
    const header = schema.name ? `// ---- ${schema.name} ----\n` : '';
    const parts: string[] = [];
    for (const entry of schema.entries) {
      switch (entry.type) {
        case 'struct':
          parts.push(emitStruct(entry, referenced));
          declaredTypes.push(sanitizeIdentifier(entry.name));
          break;
        case 'union':
          parts.push(emitUnion(entry, referenced));
          declaredTypes.push(sanitizeIdentifier(entry.name));
          break;
        case 'enum':
        case 'error':
          parts.push(emitEnum(entry));
          declaredTypes.push(sanitizeIdentifier(entry.name));
          break;
        default:
          break;
      }
    }
    if (options.emitClient !== false) {
      const client = emitClientInterface(schema, referenced);
      if (client) {
        parts.push(client);
        const clientName = `${sanitizeIdentifier(pascalCase(schema.name || 'Contract'))}Client`;
        declaredTypes.push(clientName);
      }
    }
    if (parts.length) chunks.push(header + parts.join('\n'));
  }

  // Warn about UDTs referenced but never defined in any provided schema.
  for (const ref of referenced) {
    if (!definedUdts.has(ref)) {
      warnings.push(
        `Referenced type "${ref}" is not defined in the provided schema(s); emitted as an unresolved reference.`
      );
    }
  }

  // Warn about collisions with manually-maintained types.
  const manualNames = new Set([
    ...(options.manualTypeNames ?? []),
    ...(options.manualTypesSource ? extractExportedTypeNames(options.manualTypesSource) : []),
  ]);
  for (const name of declaredTypes) {
    if (manualNames.has(name)) {
      warnings.push(
        `Generated type "${name}" collides with a manually-maintained type of the same name. ` +
          `Review the generated definition before importing it, or alias one of them.`
      );
    }
  }

  const needsRWASDKError = chunks.some((c) => c.includes('RWASDKError'));
  const imports = needsRWASDKError ? `import type { RWASDKError } from './errors';\n\n` : '';
  const banner = options.banner ?? DEFAULT_BANNER;
  const warningComment = warnings.length
    ? `\n/* Generation warnings:\n${warnings.map((w) => ` * - ${w}`).join('\n')}\n */\n`
    : '';

  const code = `${banner}${warningComment}\n${imports}${chunks.join('\n\n')}\n`;
  return { code, warnings, declaredTypes };
}

// --- Schema loading ---------------------------------------------------

/** Normalise a raw JSON blob (array of entries, or `{ entries: [...] }`). */
export function schemaFromJson(raw: unknown, name?: string): ContractSchema {
  if (Array.isArray(raw)) return { name, entries: raw as SpecEntry[] };
  const obj = raw as any;
  if (obj && Array.isArray(obj.entries)) {
    return { name: obj.name ?? name, contractId: obj.contractId, entries: obj.entries };
  }
  throw new Error('Unrecognised schema JSON: expected an array of spec entries or { entries: [...] }');
}

export async function loadSchemaFile(filePath: string): Promise<ContractSchema> {
  const abs = path.resolve(filePath);
  const raw = JSON.parse(await fs.readFile(abs, 'utf8'));
  const fallbackName = pascalCase(path.basename(abs).replace(/\.[^.]+$/, ''));
  return schemaFromJson(raw, fallbackName);
}

export interface FetchSchemaOptions {
  contractId: string;
  rpcUrl: string;
  networkPassphrase?: string;
  name?: string;
}

/**
 * Fetch a contract's spec entries from a live network and normalise them into
 * a {@link ContractSchema}. Uses the `contract` namespace of stellar-sdk.
 */
export async function fetchContractSchema(opts: FetchSchemaOptions): Promise<ContractSchema> {
  let sdk: any;
  try {
    sdk = await import('stellar-sdk');
  } catch {
    throw new Error('stellar-sdk is required to fetch contract schemas from a network.');
  }
  const contractNs = sdk.contract ?? sdk.default?.contract;
  if (!contractNs?.Client?.from) {
    throw new Error(
      'This stellar-sdk build does not expose contract.Client.from(); pass a --schema JSON file instead.'
    );
  }
  const client = await contractNs.Client.from({
    contractId: opts.contractId,
    rpcUrl: opts.rpcUrl,
    networkPassphrase: opts.networkPassphrase,
  });
  const rawEntries: any[] = client.spec?.entries ?? client.spec?._entries ?? [];
  const entries = rawEntries.map(normalizeXdrSpecEntry).filter(Boolean) as SpecEntry[];
  return { name: opts.name, contractId: opts.contractId, entries };
}

/**
 * Best-effort conversion of a stellar-sdk XDR `ScSpecEntry` into the local
 * spec model. Defensive: unknown shapes are skipped (returns null).
 */
export function normalizeXdrSpecEntry(entry: any): SpecEntry | null {
  const kind = typeof entry?.switch === 'function' ? entry.switch().name : entry?.kind;
  const val =
    typeof entry?.value === 'function' ? entry.value() : (entry?.functionV0 ?? entry?.udtStructV0 ?? entry);

  const readName = (x: any): string =>
    typeof x === 'string' ? x : x?.toString?.() ?? String(x ?? '');

  const conv = (t: any): SpecType => normalizeXdrType(t);

  if (kind?.includes('FunctionV0') || val?.inputs) {
    return {
      type: 'function',
      name: readName(val.name),
      doc: val.doc ? readName(val.doc) : undefined,
      inputs: (val.inputs ?? []).map((i: any) => ({ name: readName(i.name), type: conv(i.type) })),
      outputs: (val.outputs ?? []).map(conv),
    };
  }
  if (kind?.includes('UdtStructV0') || val?.fields) {
    return {
      type: 'struct',
      name: readName(val.name),
      doc: val.doc ? readName(val.doc) : undefined,
      fields: (val.fields ?? []).map((f: any) => ({ name: readName(f.name), type: conv(f.type) })),
    };
  }
  if (kind?.includes('UdtUnionV0') || val?.cases) {
    return {
      type: 'union',
      name: readName(val.name),
      cases: (val.cases ?? []).map((c: any) => {
        const cv = typeof c.value === 'function' ? c.value() : c;
        return {
          name: readName(cv.name),
          values: (cv.type ? [cv.type] : cv.types ?? []).map(conv),
        };
      }),
    };
  }
  if (kind?.includes('UdtEnumV0') || (val?.cases && val.cases[0]?.value !== undefined)) {
    return {
      type: 'enum',
      name: readName(val.name),
      cases: (val.cases ?? []).map((c: any) => ({ name: readName(c.name), value: Number(c.value) })),
    };
  }
  if (kind?.includes('UdtErrorEnumV0')) {
    return {
      type: 'error',
      name: readName(val.name),
      cases: (val.cases ?? []).map((c: any) => ({ name: readName(c.name), value: Number(c.value) })),
    };
  }
  return null;
}

function normalizeXdrType(t: any): SpecType {
  if (!t) return { type: 'void' };
  const sw = typeof t?.switch === 'function' ? t.switch().name : t?.type ?? t;
  const name = String(sw).toLowerCase();
  const val = typeof t?.value === 'function' ? t.value() : undefined;

  if (name.includes('option')) return { type: 'option', value: normalizeXdrType(val?.valueType ?? val) };
  if (name.includes('vec')) return { type: 'vec', element: normalizeXdrType(val?.elementType ?? val) };
  if (name.includes('map'))
    return { type: 'map', key: normalizeXdrType(val?.keyType), value: normalizeXdrType(val?.valueType) };
  if (name.includes('tuple'))
    return { type: 'tuple', elements: (val?.valueTypes ?? []).map(normalizeXdrType) };
  if (name.includes('bytesn')) return { type: 'bytesN', n: Number(val?.n ?? 32) };
  if (name.includes('result'))
    return { type: 'result', value: normalizeXdrType(val?.okType), error: normalizeXdrType(val?.errorType) };
  if (name.includes('udt')) return { type: 'udt', name: String(val?.name ?? val ?? 'Unknown') };

  const prim = (
    [
      'void', 'bool', 'u32', 'i32', 'u64', 'i64', 'u128', 'i128', 'u256', 'i256',
      'timepoint', 'duration', 'symbol', 'string', 'address', 'bytes', 'error',
    ] as SpecPrimitive[]
  ).find((p) => name.includes(p));
  return { type: prim ?? 'void' } as SpecType;
}

// --- End-to-end helper ---------------------------------------------

export interface RunGeneratorOptions {
  schemaFiles?: string[];
  contracts?: string[];
  rpcUrl?: string;
  networkPassphrase?: string;
  outFile?: string;
  emitClient?: boolean;
  manualTypesFile?: string;
  dryRun?: boolean;
}

export interface RunGeneratorResult extends GenerateResult {
  outFile?: string;
  written: boolean;
  schemasLoaded: number;
}

/**
 * Load schemas (from files and/or the network), generate types, and optionally
 * write them to disk. Returns the code, warnings and what was written.
 */
export async function runTypeGenerator(options: RunGeneratorOptions): Promise<RunGeneratorResult> {
  const schemas: ContractSchema[] = [];

  for (const file of options.schemaFiles ?? []) {
    schemas.push(await loadSchemaFile(file));
  }

  if (options.contracts?.length) {
    if (!options.rpcUrl) {
      throw new Error('--rpc-url is required when fetching schemas via --contracts');
    }
    for (const contractId of options.contracts) {
      schemas.push(
        await fetchContractSchema({
          contractId,
          rpcUrl: options.rpcUrl,
          networkPassphrase: options.networkPassphrase,
          name: contractId,
        })
      );
    }
  }

  if (schemas.length === 0) {
    throw new Error('No schemas provided. Pass --schema <file.json> and/or --contracts <ids>.');
  }

  let manualTypesSource: string | undefined;
  if (options.manualTypesFile) {
    manualTypesSource = await fs.readFile(path.resolve(options.manualTypesFile), 'utf8').catch(() => undefined);
  }

  const result = generateTypes(schemas, {
    emitClient: options.emitClient,
    manualTypesSource,
  });

  let written = false;
  if (options.outFile && !options.dryRun) {
    await fs.writeFile(path.resolve(options.outFile), result.code, 'utf8');
    written = true;
  }

  return {
    ...result,
    outFile: options.outFile,
    written,
    schemasLoaded: schemas.length,
  };
}
