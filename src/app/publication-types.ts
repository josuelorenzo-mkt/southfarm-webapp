export type PublicationPlatform = "instagram" | "tiktok" | "youtube";

export type PublicationStatus =
  | "queued" | "claimed" | "preparing" | "transferring" | "selecting_media"
  | "editing" | "captioning" | "ready_to_publish" | "publishing" | "verifying"
  | "cancellation_requested" | "completed" | "cancelled" | "failed" | "review_required";

export interface PublicationDevice {
  id: number;
  device_id: string;
  device_name: string | null;
  display_name?: string | null;
  alias?: string | null;
  online: boolean;
  lifecycle_status?: string;
  current_task?: { id: number; status: string; task_type: string } | null;
}

export interface PublicationAccount {
  id: number;
  device_id: number;
  platform: PublicationPlatform;
  username: string;
  display_name?: string;
}

export interface PublicationMedia {
  id: number;
  media_key: string;
  original_filename: string;
  mime_type: string;
  file_extension: string;
  size_bytes: number;
  sha256: string;
}

export interface PublicationEvent {
  id: number;
  from_status: PublicationStatus | null;
  to_status: PublicationStatus | null;
  current_step: string | null;
  message: string | null;
  actor_type: string | null;
  created_at: string;
  payload: Record<string, unknown> | null;
}

export interface PublicationJob {
  id: number;
  workspace_id: number;
  device_id: number;
  social_account_id: number;
  platform: PublicationPlatform;
  caption: string;
  word_count: number;
  scheduled_for: string;
  status: PublicationStatus;
  current_step: string;
  progress_percent: number;
  attempt_count: number;
  final_action_at: string | null;
  published_at: string | null;
  verified_at: string | null;
  remote_post_identity: string | null;
  error_code: string | null;
  error_message: string | null;
  cancel_requested_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Evidencia adjuntada por el worker (dumps/texto) cuando el job quedó en review_required. */
  result?: unknown;
  media?: PublicationMedia;
  events?: PublicationEvent[];
}

export interface PublicationsResponse { publications: PublicationJob[] }
export interface PublicationResponse { publication: PublicationJob }
export interface PublicationApiError { error_code?: string; error?: string }
