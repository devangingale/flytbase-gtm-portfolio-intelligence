export type SyncStatus = 'ok' | 'degraded' | 'error';

export interface Meta {
  generated_at: string;
  last_sync_at: string;
  sync_status: SyncStatus;
  source_doc_count: number;
}

export interface Totals {
  arr_total: number;
  arr_secure: number;
  arr_at_risk: number;
  arr_lost: number;
  forecast: number;
  forecast_basis: string;
}

export type HealthStatus = 'healthy' | 'at_risk' | 'critical' | 'warm' | 'lost' | 'churned' | 'stale';

export interface AccountHealth {
  derived: HealthStatus | string;
  crm_label: HealthStatus | string;
  mismatch: boolean;
  mismatch_reason: string | null;
}

export type ContactRole = 'champion' | 'economic_buyer' | 'evaluator' | 'former_champion' | 'influencer' | string;
export type InfluenceLevel = 'high' | 'medium' | 'low';
export type ContactStatus = 'engaged' | 'gone_quiet' | 'cold' | 'lapsed' | string;

export interface Contact {
  name: string;
  title: string;
  role: ContactRole;
  influence: InfluenceLevel;
  last_contact_at: string;
  status: ContactStatus;
}

export interface UsageSeriesPoint {
  month: string;
  flight_hours: number;
  missions: number;
}

export type UsageTrend = 'growing' | 'stable' | 'declining' | string;

export interface Usage {
  trend: UsageTrend;
  pct_change: number;
  series: UsageSeriesPoint[];
}

export type SeverityLevel = 'high' | 'medium' | 'low';

export interface Risk {
  id: string;
  title: string;
  severity: SeverityLevel;
  summary: string;
  evidence: string[]; // doc_id array
}

export interface Opportunity {
  id: string;
  title: string;
  value_estimate: number;
  is_trap: boolean;
  counter_signal: string | null;
  evidence: string[]; // doc_id array
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Claim {
  id: string;
  field: string;
  value: string;
  confidence: ConfidenceLevel;
  evidence: string[]; // doc_id array
}

export interface WinbackAssessment {
  applicable: boolean;
  worth_pursuing: boolean;
  rationale: string;
  required_effort: string;
}

export type LifecycleStage = 'active_customer' | 'onboarding' | 'renewal_pending' | 'prospect' | 'churned' | string;

export interface Account {
  id: string;
  name: string;
  stage: LifecycleStage;
  arr: number;
  renewal_date: string | null;
  health: AccountHealth;
  contacts: Contact[];
  usage: Usage | null;
  risks: Risk[];
  opportunities: Opportunity[];
  claims: Claim[];
  winback: WinbackAssessment | null;
}

export type ActionBucket = 'now' | 'this_week' | 'watch';

export interface ActionItem {
  id: string;
  account_id: string;
  action: string;
  why: string;
  reason_codes: string[];
  urgency: number; // 0 to 100
  bucket: ActionBucket;
  evidence: string[]; // doc_id array
}

export type DocumentType = 'call_transcript' | 'email' | 'support_ticket' | 'usage_record' | 'internal_note' | string;
export type DocumentStatus = 'active' | 'withdrawn';

export interface SourceDocument {
  id: string;
  account_id: string;
  type: DocumentType;
  title: string;
  date: string;
  excerpt: string;
  status: DocumentStatus;
}

export type ChangeFeedType = 'document_added' | 'document_withdrawn' | 'usage_updated' | 'account_rederived' | 'claim_invalidated' | string;

export interface ChangeFeedEntry {
  id: string;
  at: string;
  account_id: string;
  type: ChangeFeedType;
  description: string;
  consequence: string;
}

export interface PortfolioData {
  meta: Meta;
  totals: Totals;
  accounts: Account[];
  actions: ActionItem[];
  documents: SourceDocument[];
  change_feed: ChangeFeedEntry[];
}
