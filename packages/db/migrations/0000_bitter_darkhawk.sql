CREATE TABLE "channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"channel_id" text NOT NULL,
	"channel_name" text NOT NULL,
	"enabled" boolean DEFAULT true,
	"auto_start" boolean DEFAULT true,
	"analyzer_mode" text DEFAULT 'rules',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "highlights" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"emotion" text NOT NULL,
	"intensity" real NOT NULL,
	"duration_ms" integer,
	"offset_sec" integer,
	"samples" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"status" text DEFAULT 'live',
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"total_messages" integer DEFAULT 0,
	"total_highlights" integer DEFAULT 0,
	"peak_intensity" real DEFAULT 0,
	"peak_msg_rate" integer DEFAULT 0,
	"dominant_emotion" text,
	"stream_title" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"dominant" text NOT NULL,
	"hype" real DEFAULT 0,
	"funny" real DEFAULT 0,
	"sad" real DEFAULT 0,
	"angry" real DEFAULT 0,
	"intensity" real DEFAULT 0,
	"msg_count" integer DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_id" text NOT NULL,
	"username" text NOT NULL,
	"display_name" text,
	"email" text,
	"avatar_url" text,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_expires" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "highlights" ADD CONSTRAINT "highlights_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_channels_unique" ON "channels" USING btree ("user_id","platform","channel_id");--> statement-breakpoint
CREATE INDEX "idx_channels_user" ON "channels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_highlights_session" ON "highlights" USING btree ("session_id","ts");--> statement-breakpoint
CREATE INDEX "idx_sessions_channel" ON "sessions" USING btree ("channel_id","started_at");--> statement-breakpoint
CREATE INDEX "idx_snapshots_session" ON "snapshots" USING btree ("session_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_provider" ON "users" USING btree ("provider","provider_id");