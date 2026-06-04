-- M18 声音复刻 · 技师 ElevenLabs 克隆 voice_id
ALTER TABLE "therapists" ADD COLUMN IF NOT EXISTS "eleven_voice_id" text;
