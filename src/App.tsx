import { useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmImport,
  exportUrl,
  getImport,
  getImports,
  getProfiles,
  getRecords,
  getLatestMedicationAudit,
  getMedicationAudit,
  getMedicationAuditFindings,
  medicationAuditExportUrl,
  originalSourceExportUrl,
  pauseMedicationAudit,
  resumeMedicationAudit,
  cancelMedicationAudit,
  startMedicationAudit,
  saveMapping,
  uploadImport,
  type ImportDetails,
  type ImportListItem,
  type MappingProfile,
  type MedicationRecord,
  type MedicationAuditFinding,
  type MedicationAuditRun,
  type TargetField,
} from './api';

const fieldOptions: { value: TargetField; label: string; description: string }[] = [
  { value: 'ignore', label: 'Do not import', description: 'Keep in source file only' },
  { value: 'id', label: 'External medication ID', description: 'Your internal product or drug ID' },
  { value: 'name', label: 'Medication name', description: 'Display name or drug description' },
  { value: 'rxcui', label: 'RxCUI', description: 'RxNorm concept identifier' },
  { value: 'ndc', label: 'NDC', description: 'National Drug Code' },
  { value: 'strength', label: 'Strength', description: 'Medication strength or dose' },
  { value: 'dosageForm', label: 'Dosage form', description: 'Tablet, capsule, solution, etc.' },
  { value: 'brandName', label: 'Brand name', description: 'Brand or trade name' },
];

const requiredIdentifierFields: TargetField[] = ['rxcui', 'ndc'];

type Step = 1 | 2 | 3;

function App() {
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [worksheet, setWorksheet] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('');
  const [profiles, setProfiles] = useState<MappingProfile[]>([]);
  const [imports, setImports] = useState<ImportListItem[]>([]);
  const [details, setDetails] = useState<ImportDetails | null>(null);
  const [mapping, setMapping] = useState<Record<string, TargetField>>({});
  const [saveProfile, setSaveProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [records, setRecords] = useState<MedicationRecord[]>([]);
  const [recordCount, setRecordCount] = useState(0);
  const [page, setPage] = useState(1);
  const [auditRun, setAuditRun] = useState<MedicationAuditRun | null>(null);
  const [auditFindings, setAuditFindings] = useState<MedicationAuditFinding[]>([]);
  const [auditFindingCount, setAuditFindingCount] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditStatusFilter, setAuditStatusFilter] = useState('');
  const [auditTypeFilter, setAuditTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void refreshWorkspace();
  }, []);

  useEffect(() => {
    if (!auditRun || !['Queued', 'Running', 'Pausing', 'Cancelling'].includes(auditRun.status)) return;
    let cancelled = false;
    let requestInFlight = false;

    const refreshAudit = async () => {
      if (requestInFlight) return;
      requestInFlight = true;

      try {
        const updated = await getMedicationAudit(auditRun.id);
        if (cancelled) return;

        // The backend writes findings in small batches. Fetch the newest page
        // while processing, then return to source-row order once completed.
        const showLatest = ['Queued', 'Running', 'Pausing', 'Cancelling'].includes(updated.status);
        const result = await getMedicationAuditFindings(
          updated.id,
          1,
          50,
          auditStatusFilter,
          auditTypeFilter,
          showLatest,
        );

        if (cancelled) return;
        setAuditFindings(result.items);
        setAuditFindingCount(result.totalCount);
        setAuditPage(1);
        setAuditRun(updated);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not refresh audit progress.');
        }
      } finally {
        requestInFlight = false;
      }
    };

    void refreshAudit();
    const timer = window.setInterval(() => void refreshAudit(), 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [auditRun?.id, auditRun?.status, auditStatusFilter, auditTypeFilter]);

  async function loadLatestAudit(importId: string) {
    const latest = await getLatestMedicationAudit(importId);
    setAuditRun(latest);
    setAuditFindings([]);
    setAuditFindingCount(0);
    setAuditPage(1);
    setAuditStatusFilter('');
    setAuditTypeFilter('');
    if (latest) {
      const result = await getMedicationAuditFindings(
        latest.id,
        1,
        50,
        '',
        '',
        ['Queued', 'Running', 'Pausing', 'Cancelling'].includes(latest.status),
      );
      setAuditFindings(result.items);
      setAuditFindingCount(result.totalCount);
    }
  }

  async function refreshWorkspace() {
    try {
      const [profileData, importData] = await Promise.all([getProfiles(), getImports()]);
      setProfiles(profileData);
      setImports(importData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workspace data.');
    }
  }

  const mappedCount = useMemo(
    () => Object.values(mapping).filter((value) => value !== 'ignore').length,
    [mapping],
  );
  const hasIdentifier = requiredIdentifierFields.some((field) => Object.values(mapping).includes(field));

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    const lowerName = nextFile.name.toLowerCase();
    if (!(lowerName.endsWith('.csv') || lowerName.endsWith('.xlsx'))) {
      setError('Please choose a CSV or XLSX file.');
      return;
    }
    if (nextFile.size > 10 * 1024 * 1024) {
      setError('The file is larger than the 10 MB MVP limit.');
      return;
    }
    setError('');
    setNotice('');
    setFile(nextFile);
  }

  async function handleUpload() {
    if (!file) {
      setError('Choose a CSV or XLSX file first.');
      return;
    }
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const result = await uploadImport(file, worksheet, selectedProfile);
      setDetails(result);
      const initialMapping: Record<string, TargetField> = {};
      result.columns.forEach((column) => {
        initialMapping[column.sourceName] = column.suggestedTargetField ?? 'ignore';
      });
      setMapping(initialMapping);
      setSaveProfile(false);
      setProfileName('');
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The file could not be uploaded.');
    } finally {
      setLoading(false);
    }
  }

  function updateMapping(sourceColumn: string, nextTarget: TargetField) {
    setMapping((current) => {
      const updated = { ...current };
      if (nextTarget !== 'ignore') {
        // The API enforces one-to-one canonical mapping. Clear any previous source using this target.
        Object.keys(updated).forEach((source) => {
          if (source !== sourceColumn && updated[source] === nextTarget) updated[source] = 'ignore';
        });
      }
      updated[sourceColumn] = nextTarget;
      return updated;
    });
  }

  async function handleConfirmMapping() {
    if (!details) return;
    if (!hasIdentifier) {
      setError('Map at least one identifier column to RxCUI or NDC before continuing.');
      return;
    }
    if (saveProfile && !profileName.trim()) {
      setError('Enter a name for the mapping profile, or turn off profile saving.');
      return;
    }

    setLoading(true);
    setError('');
    setNotice('');
    try {
      const mappings = Object.entries(mapping).map(([sourceColumn, targetField]) => ({ sourceColumn, targetField: targetField as TargetField }));
      await saveMapping(details.id, mappings, saveProfile ? profileName.trim() : null);
      const confirmed = await confirmImport(details.id);
      const pageData = await getRecords(details.id, 1, 50);
      setRecords(pageData.items);
      setRecordCount(pageData.totalCount);
      setPage(1);
      setNotice(confirmed.message);
      setStep(3);
      await refreshWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import could not be confirmed.');
    } finally {
      setLoading(false);
    }
  }

  async function loadRecordPage(nextPage: number) {
    if (!details) return;
    setLoading(true);
    try {
      const result = await getRecords(details.id, nextPage, 50);
      setRecords(result.items);
      setRecordCount(result.totalCount);
      setPage(result.page);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load imported records.');
    } finally {
      setLoading(false);
    }
  }

  async function handleStartAudit() {
    if (!details) return;
    setLoading(true);
    setError('');
    setNotice('');
    setAuditFindings([]);
    setAuditFindingCount(0);
    setAuditStatusFilter('');
    setAuditTypeFilter('');
    setAuditPage(1);
    try {
      const result = await startMedicationAudit(details.id);
      setAuditRun(result.audit);
      setNotice(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the medication audit.');
    } finally {
      setLoading(false);
    }
  }

  async function handleAuditControl(action: 'pause' | 'resume' | 'cancel') {
    if (!auditRun) return;

    if (action === 'cancel') {
      const confirmed = window.confirm(
        'Cancel this terminology audit? Completed findings will be kept, but the audit will not continue.',
      );
      if (!confirmed) return;
    }

    setLoading(true);
    setError('');
    setNotice('');

    try {
      const updated = action === 'pause'
        ? await pauseMedicationAudit(auditRun.id)
        : action === 'resume'
          ? await resumeMedicationAudit(auditRun.id)
          : await cancelMedicationAudit(auditRun.id);

      const showLatest = ['Queued', 'Running', 'Pausing', 'Cancelling'].includes(updated.status);
      const result = await getMedicationAuditFindings(
        updated.id,
        1,
        50,
        auditStatusFilter,
        auditTypeFilter,
        showLatest,
      );

      setAuditRun(updated);
      setAuditFindings(result.items);
      setAuditFindingCount(result.totalCount);
      setAuditPage(1);

      setNotice(
        action === 'pause'
          ? 'Audit paused. Your progress and completed findings have been saved.'
          : action === 'resume'
            ? 'Audit resumed from the saved checkpoint.'
            : 'Audit cancelled. Completed findings have been retained.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the audit state.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditFindingPage(nextPage: number, nextStatus = auditStatusFilter, nextType = auditTypeFilter) {
    if (!auditRun) return;
    setLoading(true);
    try {
      const result = await getMedicationAuditFindings(
        auditRun.id,
        nextPage,
        50,
        nextStatus,
        nextType,
        auditRun.status !== 'Completed',
      );
      setAuditFindings(result.items);
      setAuditFindingCount(result.totalCount);
      setAuditPage(result.page);
      setAuditStatusFilter(nextStatus);
      setAuditTypeFilter(nextType);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit findings.');
    } finally {
      setLoading(false);
    }
  }

  function downloadAudit(format: 'csv' | 'xlsx') {
    if (!auditRun) return;
    const link = document.createElement('a');
    link.href = medicationAuditExportUrl(auditRun.id, format);
    link.download = `medidrift-audit-${auditRun.id}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function openPreviousImport(importId: string) {
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const previous = await getImport(importId);
      setDetails(previous);
      const restored: Record<string, TargetField> = {};
      previous.columns.forEach((column) => {
        restored[column.sourceName] = previous.savedMapping[column.sourceName]
          ?? column.suggestedTargetField
          ?? 'ignore';
      });
      setMapping(restored);
      if (previous.status === 'Imported') {
        const pageData = await getRecords(previous.id, 1, 50);
        setRecords(pageData.items);
        setRecordCount(pageData.totalCount);
        setPage(1);
        setStep(3);
        await loadLatestAudit(previous.id);
      } else {
        setAuditRun(null);
        setAuditFindings([]);
        setStep(2);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open this import.');
    } finally {
      setLoading(false);
    }
  }

  function startNewImport() {
    setStep(1);
    setFile(null);
    setWorksheet('');
    setSelectedProfile('');
    setDetails(null);
    setMapping({});
    setRecords([]);
    setRecordCount(0);
    setAuditRun(null);
    setAuditFindings([]);
    setAuditFindingCount(0);
    setAuditPage(1);
    setAuditStatusFilter('');
    setAuditTypeFilter('');
    setError('');
    setNotice('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function download(format: 'csv' | 'xlsx') {
    if (!details) return;
    const link = document.createElement('a');
    link.href = exportUrl(details.id, format);
    link.download = `medidrift-${details.id}.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function downloadOriginalSource() {
    if (!details) return;
    const link = document.createElement('a');
    link.href = originalSourceExportUrl(details.id);
    link.download = `medidrift-${details.id}-original-source.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  const totalPages = Math.max(1, Math.ceil(recordCount / 50));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span>✚</span></div>
          <div>
            <div className="brand-name">MediDrift</div>
            <div className="brand-caption">CATALOGUE INTELLIGENCE</div>
          </div>
        </div>

        <div className="workspace-switcher">
          <div className="workspace-avatar">MW</div>
          <div className="workspace-copy">
            <span className="muted-label">WORKSPACE</span>
            <strong>My Workspace</strong>
          </div>
          <span className="switch-chevron">⌄</span>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <button className={`nav-item ${step !== 3 ? 'active' : ''}`} onClick={startNewImport}>
          <span className="nav-icon">⇧</span> New import
        </button>
        <button className={`nav-item ${step === 3 ? 'active' : ''}`} onClick={() => details && setStep(3)} disabled={!details || details.status !== 'Imported'}>
          <span className="nav-icon">▤</span> Current results
        </button>
        <div className="sidebar-section-label history-label">RECENT IMPORTS</div>
        <div className="recent-imports">
          {imports.slice(0, 5).map((item) => (
            <button className="recent-import" key={item.id} onClick={() => void openPreviousImport(item.id)}>
              <span className="recent-file-icon">▦</span>
              <span className="recent-file-name">{item.fileName}</span>
              <span className={`mini-status ${item.status.toLowerCase()}`}></span>
            </button>
          ))}
          {imports.length === 0 && <div className="empty-history">Your imports will appear here.</div>}
        </div>

        <div className="sidebar-footer">
          <div className="secure-indicator"><span></span> Shared pilot workspace</div>
          <div className="sidebar-footer-note">MVP · v0.1.0</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>{step === 1 ? 'New import' : step === 2 ? 'Column mapping' : 'Import results'}</strong></div>
          <div className="topbar-right">
            <span className="environment-pill"><i></i> PILOT</span>
            <div className="user-avatar">A</div>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MEDICATION DATA QUALITY</div>
              <h1>{step === 1 ? 'Import your medication catalogue' : step === 2 ? 'Review column mappings' : 'Import completed'}</h1>
              <p>{step === 1
                ? 'Bring your existing CSV or Excel structure. You do not need to rename your columns.'
                : step === 2
                  ? 'Match your source columns to MediDrift fields before any records are normalized.'
                  : 'Your source data has been normalized and saved. Review the imported records below.'}</p>
            </div>
            {step !== 1 && <button className="button button-secondary" onClick={startNewImport}>＋ New import</button>}
          </div>

          <div className="stepper-card">
            <StepIndicator number={1} label="Upload file" active={step === 1} complete={step > 1} />
            <div className={`step-connector ${step > 1 ? 'complete' : ''}`}></div>
            <StepIndicator number={2} label="Map columns" active={step === 2} complete={step > 2} />
            <div className={`step-connector ${step > 2 ? 'complete' : ''}`}></div>
            <StepIndicator number={3} label="Review records" active={step === 3} complete={false} />
          </div>

          {error && <div className="alert alert-error"><span>!</span><div>{error}</div><button onClick={() => setError('')}>×</button></div>}
          {notice && <div className="alert alert-success"><span>✓</span><div>{notice}</div><button onClick={() => setNotice('')}>×</button></div>}

          {step === 1 && (
            <div className="upload-layout">
              <section className="panel upload-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Upload source file</h2>
                    <p>Accepted formats: CSV and XLSX · Maximum file size: 10 MB</p>
                  </div>
                  <span className="step-number">01</span>
                </div>

                <div
                  className={`drop-zone ${file ? 'has-file' : ''}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0]); }}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click(); }}
                >
                  <input ref={fileInputRef} type="file" accept=".csv,.xlsx" hidden onChange={(event) => chooseFile(event.target.files?.[0])} />
                  <div className="upload-icon">⇧</div>
                  {file ? (
                    <>
                      <strong className="selected-file-name">{file.name}</strong>
                      <span>{formatBytes(file.size)} · Ready to upload</span>
                    </>
                  ) : (
                    <>
                      <strong>Drop your file here, or <em>browse</em></strong>
                      <span>CSV or Excel workbook (.xlsx)</span>
                    </>
                  )}
                  <div className="file-format-row"><span>▤ CSV</span><span>▦ XLSX</span><span>Up to 25,000 rows</span></div>
                </div>

                <div className="upload-options">
                  <div className="field-block">
                    <label htmlFor="profile-select">Saved mapping profile <span className="optional">OPTIONAL</span></label>
                    <select id="profile-select" value={selectedProfile} onChange={(event) => setSelectedProfile(event.target.value)}>
                      <option value="">Auto-detect columns</option>
                      {profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.name}</option>)}
                    </select>
                    <small>Reuse a mapping profile created during an earlier import.</small>
                  </div>
                  <div className="field-block">
                    <label htmlFor="worksheet">Worksheet name <span className="optional">XLSX ONLY</span></label>
                    <input id="worksheet" value={worksheet} onChange={(event) => setWorksheet(event.target.value)} placeholder="Leave blank to use the first worksheet" />
                    <small>Leave blank to import the first worksheet. Only the selected worksheet is imported per job; import other data worksheets separately using their exact names.</small>
                  </div>
                </div>

                <div className="panel-actions">
                  <div className="privacy-note"><span>⌑</span> Uploads are stored in the hosted MediDrift database. Use synthetic data during the pilot.</div>
                  <button className="button button-primary" onClick={handleUpload} disabled={!file || loading}>
                    {loading ? <><span className="spinner"></span> Reading file…</> : <>Continue to column mapping <span>→</span></>}
                  </button>
                </div>
              </section>

              <aside className="side-information">
                <div className="info-card accent-card">
                  <div className="info-icon">✦</div>
                  <h3>Your format, your rules</h3>
                  <p>MediDrift reads your column headers and suggests matching fields. Your original file does not need to be edited.</p>
                </div>
                <div className="info-card">
                  <h3>What happens next?</h3>
                  <div className="mini-process"><span>1</span><div><strong>Detect headers</strong><small>Read your file structure and sample values.</small></div></div>
                  <div className="mini-process"><span>2</span><div><strong>Confirm mappings</strong><small>Choose what each source column means.</small></div></div>
                  <div className="mini-process"><span>3</span><div><strong>Normalize records</strong><small>Keep original row references for traceability.</small></div></div>
                </div>
                <div className="safety-note"><span>ⓘ</span><p>Do not upload patient names, prescriptions, medical records or other patient-identifiable information. This MVP is designed for medication catalogue metadata only.</p></div>
              </aside>
            </div>
          )}

          {step === 2 && details && (
            <div className="mapping-layout">
              <section className="panel mapping-panel">
                <div className="file-summary">
                  <div className="file-summary-icon">▦</div>
                  <div className="file-summary-text"><strong>{details.fileName}</strong><span>{details.totalRows.toLocaleString()} data rows · {details.columns.length} columns{details.worksheetName ? ` · Sheet: ${details.worksheetName}` : ''}</span></div>
                  <button className="text-button" onClick={startNewImport}>Replace file</button>
                </div>

                <div className="mapping-heading-row">
                  <div><h2>Match your columns</h2><p>Review our suggestions. Unmapped columns will be retained in the source staging data but not added to normalized fields.</p></div>
                  <div className="mapping-count"><strong>{mappedCount}</strong><span>of {details.columns.length} mapped</span></div>
                </div>

                <div className="mapping-table-wrap">
                  <table className="mapping-table">
                    <thead><tr><th>YOUR COLUMN</th><th>SAMPLE VALUE</th><th><span className="mapping-arrow">→</span> MAP TO MEDIDRIFT FIELD</th></tr></thead>
                    <tbody>
                      {details.columns.map((column) => {
                        const samples = details.sampleRows.map((row) => row[column.sourceName]).filter((value) => value?.trim()).slice(0, 2);
                        const currentTarget = mapping[column.sourceName] ?? 'ignore';
                        return (
                          <tr key={column.sourceName}>
                            <td><div className="source-name"><span className="column-symbol">▤</span><strong>{column.sourceName}</strong></div></td>
                            <td><div className="sample-values">{samples.length ? samples.map((sample, index) => <code key={`${column.sourceName}-${index}`}>{truncate(sample ?? '', 30)}</code>) : <span className="muted-value">Empty</span>}</div></td>
                            <td>
                              <div className="target-select-cell">
                                <select value={currentTarget} onChange={(event) => updateMapping(column.sourceName, event.target.value as TargetField)}>
                                  {fieldOptions.map((field) => <option value={field.value} key={field.value}>{field.label}</option>)}
                                </select>
                                {column.suggestedTargetField && currentTarget === column.suggestedTargetField && <span className="suggested-tag">Suggested</span>}
                                {column.needsReview && !column.suggestedTargetField && <span className="review-tag">Review</span>}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mapping-legend"><span><i className="legend-dot green"></i> Suggested match</span><span><i className="legend-dot amber"></i> Needs your review</span><span>Unmapped columns are not discarded from the original row evidence.</span></div>

                <div className="profile-save-box">
                  <label className="checkbox-line">
                    <input type="checkbox" checked={saveProfile} onChange={(event) => setSaveProfile(event.target.checked)} />
                    <span className="custom-checkbox"></span>
                    <span><strong>Save this mapping for future uploads</strong><small>Reuse these source column names next time.</small></span>
                  </label>
                  {saveProfile && <input className="profile-name-input" value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="e.g. Pharmacy Export Format" maxLength={120} />}
                </div>

                <div className="mapping-footer">
                  <button className="button button-secondary" onClick={() => setStep(1)}>← Back</button>
                  <div className="mapping-footer-right">
                    {!hasIdentifier && <span className="mapping-warning">Map RxCUI or NDC to continue.</span>}
                    <button className="button button-primary" onClick={handleConfirmMapping} disabled={loading || !hasIdentifier}>
                      {loading ? <><span className="spinner"></span> Importing…</> : <>Confirm mapping & import <span>→</span></>}
                    </button>
                  </div>
                </div>
              </section>

              <aside className="side-information mapping-side">
                <div className="info-card">
                  <div className="info-icon soft-blue">⌘</div>
                  <h3>Mapping rules</h3>
                  <ul className="mapping-rules"><li>Each MediDrift field can be mapped only once.</li><li>Map at least one identifier: RxCUI or NDC.</li><li>Internal IDs are not treated as medication identifiers.</li><li>Original source values and row numbers are preserved.</li></ul>
                </div>
                <div className="info-card">
                  <h3>Standard fields</h3>
                  {fieldOptions.filter((field) => field.value !== 'ignore').map((field) => <div className="field-reference" key={field.value}><strong>{field.label}</strong><small>{field.description}</small></div>)}
                </div>
                <div className="safety-note"><span>ⓘ</span><p>Mapping identifies where data belongs. It does not establish that a medication code, strength or product is clinically correct.</p></div>
              </aside>
            </div>
          )}

          {step === 3 && details && (
            <div className="results-layout">
              <section className="panel results-panel">
                <div className="success-banner"><div className="success-check">✓</div><div><h2>Catalogue imported successfully</h2><p>{details.fileName} has been normalized using your confirmed column mappings.</p></div></div>
                <div className="stat-grid">
                  <div className="stat-card"><span>ROWS IMPORTED</span><strong>{recordCount.toLocaleString()}</strong><small>All non-empty rows on this worksheet</small></div>
                  <div className="stat-card"><span>SOURCE COLUMNS RETAINED</span><strong>{details.columns.length}</strong><small>Original headers and values preserved</small></div>
                  <div className="stat-card"><span>CANONICAL FIELDS MAPPED</span><strong>{mappedCount}</strong><small>Fields used for normalized records</small></div>
                  <div className="stat-card"><span>IMPORT STATUS</span><strong className="status-text">Imported</strong><small>Saved to hosted database</small></div>
                </div>
                <section className="audit-card">
                  <div className="audit-card-heading">
                    <div>
                      <span className="audit-eyebrow">TERMINOLOGY QUALITY CHECK</span>
                      <h2>RxNorm & NDC audit</h2>
                      <p>Check RxCUIs against RxNorm historical status and NDCs against the RxNorm NDC status service. No customer identifiers are changed.</p>
                    </div>
                    <div className="audit-actions">
                      {auditRun && ['Queued', 'Running'].includes(auditRun.status) && <>
                        <button className="button button-secondary" onClick={() => void handleAuditControl('pause')} disabled={loading}>
                          {loading ? 'Updating…' : 'Ⅱ Pause'}
                        </button>
                        <button className="button button-danger" onClick={() => void handleAuditControl('cancel')} disabled={loading}>
                          Cancel
                        </button>
                      </>}
                      {auditRun?.status === 'Pausing' && <>
                        <button className="button button-secondary" disabled>Pausing…</button>
                        <button className="button button-danger" onClick={() => void handleAuditControl('cancel')} disabled={loading}>Cancel</button>
                      </>}
                      {auditRun?.status === 'Paused' && <>
                        <button className="button button-primary" onClick={() => void handleAuditControl('resume')} disabled={loading}>
                          {loading ? 'Resuming…' : '▶ Resume audit'}
                        </button>
                        <button className="button button-danger" onClick={() => void handleAuditControl('cancel')} disabled={loading}>
                          Cancel
                        </button>
                      </>}
                      {auditRun?.status === 'Cancelling' && <button className="button button-secondary" disabled>Cancelling…</button>}
                      <button
                        className="button button-primary"
                        onClick={() => void handleStartAudit()}
                        disabled={loading || ['Queued', 'Running', 'Pausing', 'Paused', 'Cancelling'].includes(auditRun?.status ?? '')}
                      >
                        {loading ? <><span className="spinner"></span> Working…</> : auditRun ? 'Run new audit' : 'Run terminology audit'}
                      </button>
                    </div>
                  </div>
                  {!auditRun && <div className="audit-empty"><span>✓</span><div><strong>Catalogue ready for terminology audit</strong><small>Checks RxCUI and NDC terminology status only. This is not a medication safety or clinical-equivalence validation. Large catalogues are processed in controlled batches. Duplicate identifiers share cached terminology lookups.</small></div></div>}
                  {auditRun && <>
                    <div className="audit-run-meta">
                      <span className={`audit-status status-${auditRun.status.toLowerCase()}`}>{auditRun.status}</span>
                      <span>{auditRun.totalRecords.toLocaleString()} records</span>
                      <span>{auditRun.totalIdentifiers.toLocaleString()} unique identifiers / missing-ID checks</span>
                      {auditRun.rxNormVersion && <span>RxNorm release {auditRun.rxNormVersion}</span>}
                    </div>
                    {['Queued', 'Running', 'Pausing', 'Paused', 'Cancelling', 'Cancelled'].includes(auditRun.status) && <div className={`audit-progress-wrap ${auditRun.status === 'Paused' ? 'audit-progress-paused' : ''}`}>
                      <div className="audit-progress-label">
                        <span>
                          {auditRun.status === 'Pausing' ? 'Pausing after the current batch…'
                            : auditRun.status === 'Paused' ? 'Audit paused'
                              : auditRun.status === 'Cancelling' ? 'Saving current batch before cancellation…'
                                : auditRun.status === 'Cancelled' ? 'Audit cancelled · partial results retained'
                                  : 'Checking terminology identifiers'}
                        </span>
                        <strong>{auditRun.progressPercent}%</strong>
                      </div>
                      <div className="audit-progress"><span style={{ width: `${auditRun.progressPercent}%` }}></span></div>
                      <small>{auditRun.processedIdentifiers.toLocaleString()} of {auditRun.totalIdentifiers.toLocaleString()} checks processed. Duplicate identifiers use one cached lookup.</small>
                      {auditRun.status === 'Paused' && <small>You can resume later. Completed findings and progress are saved.</small>}
                      {auditRun.status === 'Cancelled' && <small>This run will not continue. Start a new audit to check the remaining identifiers.</small>}
                    </div>}
                    {auditRun.status === 'Failed' && <div className="audit-error">{auditRun.errorMessage || 'The audit failed. Review backend logs and retry.'}</div>}
                    {auditRun.status === 'Completed' && <div className="audit-summary-grid">
                      <div className="audit-summary active"><strong>{auditRun.activeCount}</strong><span>Active</span></div>
                      <div className="audit-summary obsolete"><strong>{auditRun.obsoleteCount}</strong><span>Obsolete</span></div>
                      <div className="audit-summary remapped"><strong>{auditRun.remappedCount}</strong><span>Remapped</span></div>
                      <div className="audit-summary review"><strong>{auditRun.quantifiedCount + auditRun.notCurrentCount}</strong><span>Other non-current</span></div>
                      <div className="audit-summary unknown"><strong>{auditRun.unknownCount + auditRun.alienCount}</strong><span>Unknown / Alien</span></div>
                      <div className="audit-summary error"><strong>{auditRun.invalidFormatCount + auditRun.missingIdentifierCount + auditRun.lookupErrorCount}</strong><span>Needs attention</span></div>
                    </div>}
                    {['Running', 'Pausing', 'Cancelling', 'Completed', 'Failed', 'Paused', 'Cancelled'].includes(auditRun.status) && <>
                      <div className="audit-findings-heading">
                        <div>
                          <h3>{['Running', 'Pausing', 'Cancelling'].includes(auditRun.status) ? 'Live audit findings' : 'Audit findings'}</h3>
                          <p>
                            {auditFindingCount.toLocaleString()} identifier findings
                            {['Running', 'Pausing', 'Cancelling'].includes(auditRun.status)
                              ? ' · Latest results refresh automatically while the audit runs'
                              : ' · Active means terminology status only'}
                          </p>
                        </div>
                        {auditRun.status !== 'Running' && <div className="export-actions">
                          <button className="button button-secondary button-small" onClick={() => downloadAudit('csv')}>↓ CSV</button>
                          <button className="button button-secondary button-small" onClick={() => downloadAudit('xlsx')}>↓ Excel</button>
                        </div>}
                      </div>
                      <div className="audit-filters">
                        <select value={auditStatusFilter} onChange={(event) => void loadAuditFindingPage(1, event.target.value, auditTypeFilter)} aria-label="Filter by audit status">
                          <option value="">All statuses</option>
                          {['Active', 'Obsolete', 'Remapped', 'Quantified', 'NotCurrent', 'Unknown', 'Alien', 'InvalidFormat', 'MissingIdentifier', 'LookupError'].map((item) => <option key={item} value={item}>{item}</option>)}
                        </select>
                        <select value={auditTypeFilter} onChange={(event) => void loadAuditFindingPage(1, auditStatusFilter, event.target.value)} aria-label="Filter by identifier type">
                          <option value="">All identifiers</option><option value="RxCUI">RxCUI</option><option value="NDC">NDC</option><option value="None">Missing</option>
                        </select>
                      </div>
                      <div className="records-table-wrap">
                        <table className="records-table audit-findings-table">
                          <thead><tr><th>ROW</th><th>MEDICATION</th><th>TYPE</th><th>SUBMITTED ID</th><th>STATUS</th><th>RXNORM CONCEPT / CANDIDATE</th><th>DETAIL</th></tr></thead>
                          <tbody>{auditFindings.map((finding) => <tr key={finding.id}>
                            <td className="row-number">{finding.sourceRowNumber}</td>
                            <td className="medicine-cell">{finding.medicationName || finding.externalId || '—'}</td>
                            <td>{finding.identifierType}</td>
                            <td><code>{finding.submittedIdentifier || '—'}</code></td>
                            <td><span className={`finding-status finding-${finding.status.toLowerCase()}`}>{finding.status}</span></td>
                            <td><div className="finding-concept">{finding.conceptName || '—'}{finding.candidates.length > 0 && <div className="candidate-list">{finding.candidates.map((candidate) => <span key={candidate.rxcui}>{candidate.active ? 'Active candidate' : 'Inactive historical candidate'} · {candidate.rxcui}: {candidate.name}{candidate.termType ? ` (${candidate.termType})` : ''}</span>)}</div>}</div></td>
                            <td className="finding-detail">{finding.detail || '—'}</td>
                          </tr>)}</tbody>
                        </table>
                        {auditFindings.length === 0 && <div className="no-records">{['Running', 'Pausing', 'Cancelling'].includes(auditRun.status) ? 'Waiting for the first completed identifier checks. This table will populate automatically.' : auditRun.status === 'Paused' ? 'No findings have been saved yet. Resume the audit to continue.' : auditRun.status === 'Cancelled' ? 'No findings were completed before this audit was cancelled.' : 'No findings match the selected filters.'}</div>}
                      </div>
                      {['Running', 'Pausing', 'Cancelling'].includes(auditRun.status)
                        ? <div className="live-findings-note"><span className="live-dot"></span> Showing the latest 50 findings · Auto-refreshing every 1.2 seconds</div>
                        : <div className="pagination-row"><span>Audit page {auditPage} · {auditFindingCount.toLocaleString()} findings</span><div><button className="button button-secondary button-small" disabled={auditPage <= 1 || loading} onClick={() => void loadAuditFindingPage(auditPage - 1)}>Previous</button><button className="button button-secondary button-small" disabled={auditPage * 50 >= auditFindingCount || loading} onClick={() => void loadAuditFindingPage(auditPage + 1)}>Next</button></div></div>}
                    </>}
                  </>}
                </section>

                <div className="records-heading"><div><h2>Normalized medication records</h2><p>Showing {records.length ? ((page - 1) * 50 + 1).toLocaleString() : 0}–{Math.min(page * 50, recordCount).toLocaleString()} of {recordCount.toLocaleString()} records.</p></div><div className="export-actions"><button className="button button-secondary button-small" onClick={() => download('csv')}>↓ Normalized CSV</button><button className="button button-secondary button-small" onClick={() => download('xlsx')}>↓ Full Excel workbook</button><button className="button button-secondary button-small" onClick={downloadOriginalSource}>↓ Original source CSV</button></div></div>
                <div className="records-table-wrap">
                  <table className="records-table">
                    <thead><tr><th>ROW</th><th>EXTERNAL ID</th><th>MEDICATION NAME</th><th>RxCUI</th><th>NDC</th><th>STRENGTH</th></tr></thead>
                    <tbody>
                      {records.map((record) => <tr key={record.id}><td className="row-number">{record.sourceRowNumber}</td><td>{record.externalId || '—'}</td><td className="medicine-cell">{record.medicationName || '—'}</td><td><code>{record.rxcui || '—'}</code></td><td><code>{record.ndc || '—'}</code></td><td>{record.strength || '—'}</td></tr>)}
                    </tbody>
                  </table>
                  {records.length === 0 && <div className="no-records">No normalized records were returned.</div>}
                </div>
                <div className="pagination-row"><span>Page {page} of {totalPages}</span><div><button className="button button-secondary button-small" disabled={page <= 1 || loading} onClick={() => void loadRecordPage(page - 1)}>Previous</button><button className="button button-secondary button-small" disabled={page >= totalPages || loading} onClick={() => void loadRecordPage(page + 1)}>Next</button></div></div>
              </section>
              <aside className="side-information results-side">
                <div className="info-card"><h3>What was preserved?</h3><div className="preserved-line"><span>✓</span> Original column headers</div><div className="preserved-line"><span>✓</span> Original source values</div><div className="preserved-line"><span>✓</span> Source row numbers</div><div className="preserved-line"><span>✓</span> Confirmed mapping configuration</div><p className="source-export-help">Full Excel workbook includes both normalized records and every original source column. Original source CSV exports the selected worksheet's raw values.</p></div>
                <div className="safety-note"><span>ⓘ</span><p>Terminology status is not a clinical safety assessment. Active status does not prove the product, strength, dosage form or NDC is correct for a patient.</p></div>
              </aside>
            </div>
          )}

          <footer className="page-footer"><span>© 2026 MediDrift · Medication catalogue import</span><span>Built for structured data review <b>·</b> No patient data</span></footer>
        </div>
      </main>
    </div>
  );
}

function StepIndicator({ number, label, active, complete }: { number: number; label: string; active: boolean; complete: boolean }) {
  return <div className={`step-indicator ${active ? 'active' : ''} ${complete ? 'complete' : ''}`}><span className="step-circle">{complete ? '✓' : number}</span><strong>{label}</strong></div>;
}

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export default App;
