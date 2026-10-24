-- Mức 2 quan sát chấm bài: nhật ký từng ván cho portal admin.
-- Worker (service_role) ghi sau khi `mvp_finish` nhận kết quả; portal đọc qua API
-- `/api/local/admin/judge*` (đã gate `requireLocalAdmin`).
-- Không chứa source code, hash hay storage path của bot.
CREATE TABLE public.mvp_match_logs (
  match_id   uuid PRIMARY KEY REFERENCES public.mvp_matches(id),
  notes_json text NOT NULL DEFAULT '[]' CHECK(length(notes_json) BETWEEN 2 AND 16384),
  error      text CHECK(error IS NULL OR length(error) <= 1000),
  worker     text CHECK(worker IS NULL OR length(worker) <= 200),
  elapsed_ms integer CHECK(elapsed_ms IS NULL OR elapsed_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mvp_match_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mvp_match_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.mvp_match_logs TO service_role;
