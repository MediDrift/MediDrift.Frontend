const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

export type TargetField =
  | 'ignore'
  | 'id'
  | 'name'
  | 'rxcui'
  | 'ndc'
  | 'strength'
  | 'dosageForm'
  | 'brandName';

export interface ImportColumn {
  sourceName: string;
  position: number;
  suggestedTargetField: Exclude<TargetField, 'ignore'> | null;
  suggestionConfidence: number;
  needsReview: boolean;
}

export interface ImportDetails {
  id: string;
  fileName: string;
  fileExtension: string;
  worksheetName: string | null;
  status: string;
  totalRows: number;
  createdUtc: string;
  appliedProfileName: string | null;
  columns: ImportColumn[];
  sampleRows: Record<string, string | null>[];
  savedMapping: Record<string, TargetField>;
}

export interface MappingProfile {
  id: string;
  name: string;
  mappings: Record<string, TargetField>;
  updatedUtc: string;
}

export interface MedicationRecord {
  id: number;
  sourceRowNumber: number;
  externalId: string | null;
  medicationName: string | null;
  rxcui: string | null;
  ndc: string | null;
  strength: string | null;
  dosageForm: string | null;
  brandName: string | null;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
}

export interface ImportListItem {
  id: string;
  fileName: string;
  status: string;
  totalRows: number;
  createdUtc: string;
  importedUtc: string | null;
}

export interface ApiError {
  message?: string;
  details?: string[];
  errors?: Record<string, string[]>;
  title?: string;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';

  const body = contentType.includes('json')
    ? ((await response.json()) as ApiError & T)
    : undefined;

  if (!response.ok) {
    const validationMessages = body?.errors
      ? Object.values(body.errors).flat().join(' ')
      : '';

    const message =
      body?.message ||
      validationMessages ||
      body?.title ||
      `Request failed (${response.status}).`;

    throw new Error(message);
  }

  return body as T;
}

export async function uploadImport(
  file: File,
  worksheet: string,
  mappingProfileId: string,
): Promise<ImportDetails> {
  const form = new FormData();

  form.append('file', file);

  if (worksheet.trim()) {
    form.append('worksheet', worksheet.trim());
  }

  if (mappingProfileId) {
    form.append('mappingProfileId', mappingProfileId);
  }

  const response = await fetch(apiUrl('/api/imports'), {
    method: 'POST',
    body: form,
  });

  return parseResponse<ImportDetails>(response);
}

export async function getProfiles(): Promise<MappingProfile[]> {
  const response = await fetch(apiUrl('/api/mapping-profiles'));
  return parseResponse<MappingProfile[]>(response);
}

export async function saveMapping(
  importId: string,
  mappings: { sourceColumn: string; targetField: TargetField }[],
  saveProfileName: string | null,
): Promise<ImportDetails> {
  const response = await fetch(
    apiUrl(`/api/imports/${importId}/mapping`),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mappings, saveProfileName }),
    },
  );

  return parseResponse<ImportDetails>(response);
}

export async function confirmImport(
  importId: string,
): Promise<{ importedRecords: number; status: string; message: string }> {
  const response = await fetch(
    apiUrl(`/api/imports/${importId}/confirm`),
    { method: 'POST' },
  );

  return parseResponse(response);
}

export async function getRecords(
  importId: string,
  page = 1,
  pageSize = 50,
): Promise<PagedResult<MedicationRecord>> {
  const response = await fetch(
    apiUrl(`/api/imports/${importId}/records?page=${page}&pageSize=${pageSize}`),
  );

  return parseResponse<PagedResult<MedicationRecord>>(response);
}

export async function getImport(importId: string): Promise<ImportDetails> {
  const response = await fetch(apiUrl(`/api/imports/${importId}`));
  return parseResponse<ImportDetails>(response);
}

export async function getImports(): Promise<ImportListItem[]> {
  const response = await fetch(apiUrl('/api/imports'));
  return parseResponse<ImportListItem[]>(response);
}

export function exportUrl(
  importId: string,
  format: 'csv' | 'xlsx',
): string {
  return apiUrl(
    `/api/imports/${importId}/export?format=${format}`,
  );
}

export interface MedicationAuditRun {
  id: string;
  importId: string;
  status: 'Queued' | 'Running' | 'Completed' | 'Failed' | string;
  totalRecords: number;
  totalIdentifiers: number;
  processedIdentifiers: number;
  progressPercent: number;
  activeCount: number;
  obsoleteCount: number;
  remappedCount: number;
  quantifiedCount: number;
  notCurrentCount: number;
  unknownCount: number;
  alienCount: number;
  invalidFormatCount: number;
  missingIdentifierCount: number;
  lookupErrorCount: number;
  rxNormVersion: string | null;
  createdUtc: string;
  startedUtc: string | null;
  completedUtc: string | null;
  errorMessage: string | null;
}

export interface AuditCandidate {
  rxcui: string;
  name: string;
  termType: string | null;
  active: boolean;
}

export interface MedicationAuditFinding {
  id: number;
  medicationRecordId: number;
  sourceRowNumber: number;
  externalId: string | null;
  medicationName: string | null;
  identifierType: 'RxCUI' | 'NDC' | 'None' | string;
  submittedIdentifier: string | null;
  status: string;
  conceptName: string | null;
  canonicalRxcui: string | null;
  candidates: AuditCandidate[];
  releaseStartDate: string | null;
  releaseEndDate: string | null;
  detail: string | null;
  checkedUtc: string;
}

export async function startMedicationAudit(
  importId: string,
): Promise<{ audit: MedicationAuditRun; message: string }> {
  const response = await fetch(
    apiUrl(`/api/imports/${importId}/audits`),
    { method: 'POST' },
  );

  return parseResponse(response);
}

export async function getMedicationAudit(
  auditId: string,
): Promise<MedicationAuditRun> {
  const response = await fetch(apiUrl(`/api/audits/${auditId}`));
  return parseResponse<MedicationAuditRun>(response);
}

export async function getLatestMedicationAudit(
  importId: string,
): Promise<MedicationAuditRun | null> {
  const response = await fetch(
    apiUrl(`/api/imports/${importId}/audits/latest`),
  );

  if (response.status === 204) {
    return null;
  }

  return parseResponse<MedicationAuditRun>(response);
}

export async function getMedicationAuditFindings(
  auditId: string,
  page = 1,
  pageSize = 50,
  status = '',
  identifierType = '',
): Promise<PagedResult<MedicationAuditFinding>> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (status) {
    query.set('status', status);
  }

  if (identifierType) {
    query.set('identifierType', identifierType);
  }

  const response = await fetch(
    apiUrl(`/api/audits/${auditId}/findings?${query.toString()}`),
  );

  return parseResponse<PagedResult<MedicationAuditFinding>>(response);
}

export function medicationAuditExportUrl(
  auditId: string,
  format: 'csv' | 'xlsx',
): string {
  return apiUrl(
    `/api/audits/${auditId}/export?format=${format}`,
  );
}
