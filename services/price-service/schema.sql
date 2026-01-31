--
-- PostgreSQL database dump
--


-- Dumped from database version 14.20 (Homebrew)
-- Dumped by pg_dump version 15.15 (Debian 15.15-0+deb12u1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: kosarica
--

CREATE SCHEMA drizzle;


ALTER SCHEMA drizzle OWNER TO kosarica;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: kosarica
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO kosarica;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: kosarica
--

COMMENT ON SCHEMA public IS '';


--
-- Name: claim_tasks(text, text[], integer); Type: FUNCTION; Schema: public; Owner: kosarica
--

CREATE FUNCTION public.claim_tasks(p_worker_id text, p_task_types text[], p_max_tasks integer) RETURNS TABLE(id text, task_type text, payload jsonb)
    LANGUAGE plpgsql
    AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT tq.id, tq.task_type, tq.payload
    FROM task_queue tq
    WHERE tq.status = 'pending'
      AND tq.scheduled_for <= NOW()
      AND (p_task_types IS NULL OR tq.task_type = ANY(p_task_types))
    ORDER BY tq.priority DESC, tq.scheduled_for ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_max_tasks
  )
  UPDATE task_queue tq
  SET status = 'claimed',
      started_at = NOW(),
      worker_id = p_worker_id,
      updated_at = NOW()
  FROM claimed c
  WHERE tq.id = c.id
  RETURNING tq.id, tq.task_type, tq.payload;
END;
$$;


ALTER FUNCTION public.claim_tasks(p_worker_id text, p_task_types text[], p_max_tasks integer) OWNER TO kosarica;

--
-- Name: cleanup_old_tasks(integer); Type: FUNCTION; Schema: public; Owner: kosarica
--

CREATE FUNCTION public.cleanup_old_tasks(p_days_to_keep integer DEFAULT 7) RETURNS integer
    LANGUAGE plpgsql
    AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM task_queue
  WHERE status = 'completed'
    AND completed_at < NOW() - (p_days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;


ALTER FUNCTION public.cleanup_old_tasks(p_days_to_keep integer) OWNER TO kosarica;

--
-- Name: complete_task(text, jsonb); Type: FUNCTION; Schema: public; Owner: kosarica
--

CREATE FUNCTION public.complete_task(p_task_id text, p_result jsonb DEFAULT NULL::jsonb) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE task_queue
  SET status = 'completed', completed_at = NOW(), updated_at = NOW()
  WHERE id = p_task_id AND status = 'processing';
  RETURN FOUND;
END;
$$;


ALTER FUNCTION public.complete_task(p_task_id text, p_result jsonb) OWNER TO kosarica;

--
-- Name: fail_task(text, text, boolean); Type: FUNCTION; Schema: public; Owner: kosarica
--

CREATE FUNCTION public.fail_task(p_task_id text, p_error_message text, p_retry boolean DEFAULT true) RETURNS boolean
    LANGUAGE plpgsql
    AS $$
DECLARE
  should_retry BOOLEAN;
BEGIN
  SELECT retry_count < max_retries INTO should_retry FROM task_queue WHERE id = p_task_id;
  IF p_retry AND should_retry THEN
    UPDATE task_queue
    SET status = 'pending',
        retry_count = retry_count + 1,
        scheduled_for = NOW() + ((retry_count + 1) * INTERVAL '1 minute'),
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN TRUE;
  ELSE
    UPDATE task_queue
    SET status = 'failed',
        failed_at = NOW(),
        error_message = p_error_message,
        updated_at = NOW()
    WHERE id = p_task_id;
    RETURN FALSE;
  END IF;
END;
$$;


ALTER FUNCTION public.fail_task(p_task_id text, p_error_message text, p_retry boolean) OWNER TO kosarica;

--
-- Name: recover_orphaned_tasks(); Type: FUNCTION; Schema: public; Owner: kosarica
--

CREATE FUNCTION public.recover_orphaned_tasks() RETURNS TABLE(recovered_count integer, failed_count integer)
    LANGUAGE plpgsql
    AS $$
DECLARE
  _recovered INTEGER := 0;
  _failed INTEGER := 0;
BEGIN
  -- Recover tasks stuck in 'claimed' status (worker never started processing)
  WITH recovered AS (
    UPDATE task_queue
    SET status = 'pending',
        worker_id = NULL,
        started_at = NULL,
        updated_at = NOW()
    WHERE status = 'claimed'
      AND started_at < NOW() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO _recovered FROM recovered;

  -- Handle tasks stuck in 'processing' status (worker crashed)
  WITH failed AS (
    UPDATE task_queue
    SET status = CASE WHEN retry_count < max_retries THEN 'pending' ELSE 'failed' END,
        retry_count = CASE WHEN retry_count < max_retries THEN retry_count + 1 ELSE retry_count END,
        scheduled_for = CASE WHEN retry_count < max_retries THEN NOW() + ((retry_count + 1) * INTERVAL '1 minute') ELSE scheduled_for END,
        failed_at = CASE WHEN retry_count >= max_retries THEN NOW() ELSE NULL END,
        error_message = 'Recovered from orphaned processing state',
        worker_id = NULL,
        updated_at = NOW()
    WHERE status = 'processing'
      AND started_at < NOW() - INTERVAL '15 minutes'
    RETURNING id
  )
  SELECT COUNT(*) INTO _failed FROM failed;

  RETURN QUERY SELECT _recovered, _failed;
END;
$$;


ALTER FUNCTION public.recover_orphaned_tasks() OWNER TO kosarica;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: kosarica
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


ALTER TABLE drizzle.__drizzle_migrations OWNER TO kosarica;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: kosarica
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE drizzle.__drizzle_migrations_id_seq OWNER TO kosarica;

--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: kosarica
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: account; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.account (
    id text NOT NULL,
    "accountId" text NOT NULL,
    "providerId" text NOT NULL,
    "userId" text NOT NULL,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" timestamp without time zone,
    "refreshTokenExpiresAt" timestamp without time zone,
    scope text,
    password text,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL
);


ALTER TABLE public.account OWNER TO kosarica;

--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.app_settings (
    id text NOT NULL,
    "appName" text DEFAULT 'Kosarica'::text,
    "requireEmailVerification" boolean DEFAULT false,
    "minPasswordLength" integer DEFAULT 8,
    "maxPasswordLength" integer DEFAULT 128,
    "passkeyEnabled" boolean DEFAULT true,
    "updatedAt" timestamp without time zone NOT NULL
);


ALTER TABLE public.app_settings OWNER TO kosarica;

--
-- Name: archives; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.archives (
    id text NOT NULL,
    chain_slug text NOT NULL,
    source_url text NOT NULL,
    filename text NOT NULL,
    original_format text NOT NULL,
    archive_path text NOT NULL,
    archive_type text NOT NULL,
    content_type text,
    file_size bigint,
    compressed_size bigint,
    checksum text NOT NULL,
    downloaded_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_compressed boolean DEFAULT false
);


ALTER TABLE public.archives OWNER TO kosarica;

--
-- Name: canonical_barcodes; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.canonical_barcodes (
    barcode text NOT NULL,
    product_id text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.canonical_barcodes OWNER TO kosarica;

--
-- Name: chains; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.chains (
    slug text NOT NULL,
    name text NOT NULL,
    website text,
    logo_url text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.chains OWNER TO kosarica;

--
-- Name: cron_jobs; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.cron_jobs (
    id text NOT NULL,
    name text NOT NULL,
    cron_expression text NOT NULL,
    timezone text DEFAULT 'UTC'::text,
    task_type text NOT NULL,
    task_payload jsonb,
    enabled boolean DEFAULT true,
    next_run_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_run_status text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.cron_jobs OWNER TO kosarica;

--
-- Name: cron_runs; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.cron_runs (
    id bigint NOT NULL,
    job_id text NOT NULL,
    idempotency_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_message text,
    error_details text,
    tasks_enqueued integer DEFAULT 0,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.cron_runs OWNER TO kosarica;

--
-- Name: cron_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.cron_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.cron_runs_id_seq OWNER TO kosarica;

--
-- Name: cron_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.cron_runs_id_seq OWNED BY public.cron_runs.id;


--
-- Name: group_prices; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.group_prices (
    price_group_id text NOT NULL,
    retailer_item_id text NOT NULL,
    price integer NOT NULL,
    discount_price integer,
    unit_price integer,
    anchor_price integer,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.group_prices OWNER TO kosarica;

--
-- Name: ingestion_chunks; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_chunks (
    id text NOT NULL,
    file_id bigint NOT NULL,
    chunk_index integer NOT NULL,
    start_row integer NOT NULL,
    end_row integer NOT NULL,
    row_count integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    r2_key text,
    persisted_count integer DEFAULT 0,
    error_count integer DEFAULT 0,
    processed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.ingestion_chunks OWNER TO kosarica;

--
-- Name: ingestion_errors; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_errors (
    id bigint NOT NULL,
    run_id text NOT NULL,
    file_id bigint,
    chunk_id text,
    entry_id text,
    error_type text NOT NULL,
    error_message text NOT NULL,
    error_details text,
    severity text DEFAULT 'error'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.ingestion_errors OWNER TO kosarica;

--
-- Name: ingestion_errors_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.ingestion_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.ingestion_errors_id_seq OWNER TO kosarica;

--
-- Name: ingestion_errors_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.ingestion_errors_id_seq OWNED BY public.ingestion_errors.id;


--
-- Name: ingestion_file_entries; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_file_entries (
    id text NOT NULL,
    file_id bigint NOT NULL,
    row_number integer,
    store_identifier text,
    item_external_id text,
    item_name text,
    price integer,
    discount_price integer,
    barcode text,
    raw_data text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.ingestion_file_entries OWNER TO kosarica;

--
-- Name: ingestion_files; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_files (
    id bigint NOT NULL,
    run_id text NOT NULL,
    filename text NOT NULL,
    file_type text NOT NULL,
    file_size integer,
    file_hash text,
    status text DEFAULT 'pending'::text NOT NULL,
    entry_count integer DEFAULT 0,
    processed_at timestamp without time zone,
    metadata text,
    total_chunks integer DEFAULT 0,
    processed_chunks integer DEFAULT 0,
    chunk_size integer,
    created_at timestamp without time zone DEFAULT now(),
    status_reason text,
    status_severity text,
    status_type text
);


ALTER TABLE public.ingestion_files OWNER TO kosarica;

--
-- Name: ingestion_files_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.ingestion_files_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.ingestion_files_id_seq OWNER TO kosarica;

--
-- Name: ingestion_files_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.ingestion_files_id_seq OWNED BY public.ingestion_files.id;


--
-- Name: ingestion_runs; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_runs (
    id text NOT NULL,
    chain_slug text NOT NULL,
    source text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    total_files integer DEFAULT 0,
    processed_files integer DEFAULT 0,
    total_entries integer DEFAULT 0,
    processed_entries integer DEFAULT 0,
    error_count integer DEFAULT 0,
    metadata text,
    parent_run_id text,
    rerun_type text,
    rerun_target_id text,
    created_at timestamp without time zone DEFAULT now(),
    archive_id text,
    source_url text,
    status_reason text,
    status_severity text,
    status_type text,
    target_date timestamp with time zone,
    is_forced boolean DEFAULT false
);


ALTER TABLE public.ingestion_runs OWNER TO kosarica;

--
-- Name: ingestion_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.ingestion_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.ingestion_runs_id_seq OWNER TO kosarica;

--
-- Name: ingestion_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.ingestion_runs_id_seq OWNED BY public.ingestion_runs.id;


--
-- Name: ingestion_store_stats; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.ingestion_store_stats (
    id bigint NOT NULL,
    run_id text NOT NULL,
    file_id bigint NOT NULL,
    store_id text NOT NULL,
    store_identifier text NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    persisted_count integer DEFAULT 0 NOT NULL,
    price_changes integer DEFAULT 0 NOT NULL,
    failed_rows integer DEFAULT 0 NOT NULL,
    warning_rows integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.ingestion_store_stats OWNER TO kosarica;

--
-- Name: ingestion_store_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.ingestion_store_stats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.ingestion_store_stats_id_seq OWNER TO kosarica;

--
-- Name: ingestion_store_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.ingestion_store_stats_id_seq OWNED BY public.ingestion_store_stats.id;


--
-- Name: passkey; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.passkey (
    id text NOT NULL,
    name text,
    "publicKey" text NOT NULL,
    "userId" text NOT NULL,
    "credentialID" text NOT NULL,
    counter integer NOT NULL,
    "deviceType" text NOT NULL,
    "backedUp" boolean NOT NULL,
    transports text,
    "createdAt" timestamp without time zone
);


ALTER TABLE public.passkey OWNER TO kosarica;

--
-- Name: price_groups; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.price_groups (
    id text NOT NULL,
    chain_slug text NOT NULL,
    price_hash text NOT NULL,
    hash_version integer DEFAULT 1 NOT NULL,
    store_count integer DEFAULT 0 NOT NULL,
    item_count integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp without time zone DEFAULT now() NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.price_groups OWNER TO kosarica;

--
-- Name: product_aliases; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_aliases (
    id text NOT NULL,
    product_id text NOT NULL,
    alias text NOT NULL,
    source text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_aliases OWNER TO kosarica;

--
-- Name: product_links; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_links (
    id text NOT NULL,
    product_id text NOT NULL,
    retailer_item_id text NOT NULL,
    confidence text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_links OWNER TO kosarica;

--
-- Name: product_match_audit; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_match_audit (
    id bigint NOT NULL,
    queue_id text NOT NULL,
    action text NOT NULL,
    user_id text,
    previous_state text,
    new_state text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.product_match_audit OWNER TO kosarica;

--
-- Name: product_match_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.product_match_audit_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.product_match_audit_id_seq OWNER TO kosarica;

--
-- Name: product_match_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.product_match_audit_id_seq OWNED BY public.product_match_audit.id;


--
-- Name: product_match_candidates; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_match_candidates (
    id text NOT NULL,
    retailer_item_id text NOT NULL,
    candidate_product_id text,
    similarity text,
    match_type text NOT NULL,
    rank smallint DEFAULT 1,
    flags text,
    matching_run_id text,
    model_version text,
    normalized_text_hash text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.product_match_candidates OWNER TO kosarica;

--
-- Name: product_match_queue; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_match_queue (
    id text NOT NULL,
    retailer_item_id text NOT NULL,
    status text DEFAULT 'pending'::text,
    decision text,
    linked_product_id text,
    reviewed_by text,
    reviewed_at timestamp with time zone,
    review_notes text,
    version integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.product_match_queue OWNER TO kosarica;

--
-- Name: product_match_rejections; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_match_rejections (
    retailer_item_id text NOT NULL,
    rejected_product_id text NOT NULL,
    reason text,
    rejected_by text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.product_match_rejections OWNER TO kosarica;

--
-- Name: product_relations; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.product_relations (
    id text NOT NULL,
    product_id text NOT NULL,
    related_product_id text NOT NULL,
    relation_type text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.product_relations OWNER TO kosarica;

--
-- Name: products; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.products (
    id text NOT NULL,
    name text NOT NULL,
    description text,
    category text,
    subcategory text,
    brand text,
    unit text,
    unit_quantity text,
    image_url text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.products OWNER TO kosarica;

--
-- Name: retailer_item_barcodes; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.retailer_item_barcodes (
    id text NOT NULL,
    retailer_item_id text NOT NULL,
    barcode text NOT NULL,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.retailer_item_barcodes OWNER TO kosarica;

--
-- Name: retailer_items; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.retailer_items (
    id text NOT NULL,
    retailer_item_id integer,
    barcode text,
    is_primary boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    name text NOT NULL,
    external_id text,
    description text,
    brand text,
    category text,
    subcategory text,
    unit text,
    unit_quantity text,
    image_url text,
    chain_slug text,
    archive_id text
);


ALTER TABLE public.retailer_items OWNER TO kosarica;

--
-- Name: retailer_items_failed; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.retailer_items_failed (
    id text NOT NULL,
    chain_slug text NOT NULL,
    run_id text,
    file_id bigint,
    store_identifier text,
    row_number integer,
    raw_data text NOT NULL,
    validation_errors jsonb NOT NULL,
    failed_at timestamp without time zone DEFAULT now(),
    reviewed boolean DEFAULT false,
    reviewed_by text,
    review_notes text,
    reprocessable boolean DEFAULT true,
    reprocessed_at timestamp without time zone
);


ALTER TABLE public.retailer_items_failed OWNER TO kosarica;

--
-- Name: session; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.session (
    id text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    token text NOT NULL,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "userId" text NOT NULL
);


ALTER TABLE public.session OWNER TO kosarica;

--
-- Name: store_enrichment_tasks; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_enrichment_tasks (
    id text NOT NULL,
    store_id text NOT NULL,
    type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    input_data text,
    output_data text,
    confidence text,
    verified_by text,
    verified_at timestamp without time zone,
    error_message text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.store_enrichment_tasks OWNER TO kosarica;

--
-- Name: store_group_history; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_group_history (
    id text NOT NULL,
    store_id text NOT NULL,
    price_group_id text NOT NULL,
    valid_from timestamp without time zone NOT NULL,
    valid_to timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.store_group_history OWNER TO kosarica;

--
-- Name: store_identifiers; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_identifiers (
    id text NOT NULL,
    store_id text NOT NULL,
    type text NOT NULL,
    value text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.store_identifiers OWNER TO kosarica;

--
-- Name: store_item_price_periods; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_item_price_periods (
    id bigint NOT NULL,
    store_item_state_id bigint NOT NULL,
    price integer NOT NULL,
    discount_price integer,
    started_at timestamp without time zone NOT NULL,
    ended_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.store_item_price_periods OWNER TO kosarica;

--
-- Name: store_item_price_periods_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.store_item_price_periods_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.store_item_price_periods_id_seq OWNER TO kosarica;

--
-- Name: store_item_price_periods_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.store_item_price_periods_id_seq OWNED BY public.store_item_price_periods.id;


--
-- Name: store_item_state; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_item_state (
    id bigint NOT NULL,
    store_id text NOT NULL,
    retailer_item_id text NOT NULL,
    current_price integer,
    previous_price integer,
    discount_price integer,
    discount_start timestamp without time zone,
    discount_end timestamp without time zone,
    in_stock boolean DEFAULT true,
    unit_price integer,
    unit_price_base_quantity text,
    unit_price_base_unit text,
    lowest_price_30d integer,
    anchor_price integer,
    anchor_price_as_of timestamp without time zone,
    price_signature text,
    last_seen_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.store_item_state OWNER TO kosarica;

--
-- Name: store_item_state_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.store_item_state_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.store_item_state_id_seq OWNER TO kosarica;

--
-- Name: store_item_state_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.store_item_state_id_seq OWNED BY public.store_item_state.id;


--
-- Name: store_price_exceptions; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.store_price_exceptions (
    store_id text NOT NULL,
    retailer_item_id text NOT NULL,
    price integer NOT NULL,
    discount_price integer,
    reason text NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    created_by text
);


ALTER TABLE public.store_price_exceptions OWNER TO kosarica;

--
-- Name: stores; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.stores (
    id text NOT NULL,
    chain_slug text NOT NULL,
    name text NOT NULL,
    address text,
    city text,
    postal_code text,
    latitude text,
    longitude text,
    is_virtual boolean DEFAULT true,
    price_source_store_id text,
    status text DEFAULT 'active'::text,
    approval_notes text,
    approved_by text,
    approved_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.stores OWNER TO kosarica;

--
-- Name: task_queue; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.task_queue (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    task_type text NOT NULL,
    payload jsonb NOT NULL,
    priority integer DEFAULT 0,
    status text DEFAULT 'pending'::text NOT NULL,
    scheduled_for timestamp without time zone DEFAULT now(),
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    failed_at timestamp without time zone,
    worker_id text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    error_message text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    CONSTRAINT task_queue_priority_check CHECK (((priority >= 0) AND (priority <= 10))),
    CONSTRAINT task_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'claimed'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text])))
);


ALTER TABLE public.task_queue OWNER TO kosarica;

--
-- Name: todos; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.todos (
    id integer NOT NULL,
    title text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.todos OWNER TO kosarica;

--
-- Name: todos_id_seq; Type: SEQUENCE; Schema: public; Owner: kosarica
--

CREATE SEQUENCE public.todos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.todos_id_seq OWNER TO kosarica;

--
-- Name: todos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: kosarica
--

ALTER SEQUENCE public.todos_id_seq OWNED BY public.todos.id;


--
-- Name: user; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public."user" (
    id text NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    "emailVerified" boolean NOT NULL,
    image text,
    role text DEFAULT 'user'::text,
    banned boolean DEFAULT false,
    "bannedAt" timestamp without time zone,
    "bannedReason" text,
    "createdAt" timestamp without time zone NOT NULL,
    "updatedAt" timestamp without time zone NOT NULL
);


ALTER TABLE public."user" OWNER TO kosarica;

--
-- Name: verification; Type: TABLE; Schema: public; Owner: kosarica
--

CREATE TABLE public.verification (
    id text NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    "expiresAt" timestamp without time zone NOT NULL,
    "createdAt" timestamp without time zone,
    "updatedAt" timestamp without time zone
);


ALTER TABLE public.verification OWNER TO kosarica;

--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: kosarica
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: cron_runs id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.cron_runs ALTER COLUMN id SET DEFAULT nextval('public.cron_runs_id_seq'::regclass);


--
-- Name: ingestion_errors id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors ALTER COLUMN id SET DEFAULT nextval('public.ingestion_errors_id_seq'::regclass);


--
-- Name: ingestion_files id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_files ALTER COLUMN id SET DEFAULT nextval('public.ingestion_files_id_seq'::regclass);


--
-- Name: ingestion_runs id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_runs ALTER COLUMN id SET DEFAULT nextval('public.ingestion_runs_id_seq'::regclass);


--
-- Name: ingestion_store_stats id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_store_stats ALTER COLUMN id SET DEFAULT nextval('public.ingestion_store_stats_id_seq'::regclass);


--
-- Name: product_match_audit id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_audit ALTER COLUMN id SET DEFAULT nextval('public.product_match_audit_id_seq'::regclass);


--
-- Name: store_item_price_periods id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_price_periods ALTER COLUMN id SET DEFAULT nextval('public.store_item_price_periods_id_seq'::regclass);


--
-- Name: store_item_state id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_state ALTER COLUMN id SET DEFAULT nextval('public.store_item_state_id_seq'::regclass);


--
-- Name: todos id; Type: DEFAULT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.todos ALTER COLUMN id SET DEFAULT nextval('public.todos_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: kosarica
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: account account_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);


--
-- Name: archives archives_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.archives
    ADD CONSTRAINT archives_pkey PRIMARY KEY (id);


--
-- Name: canonical_barcodes canonical_barcodes_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.canonical_barcodes
    ADD CONSTRAINT canonical_barcodes_pkey PRIMARY KEY (barcode);


--
-- Name: chains chains_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.chains
    ADD CONSTRAINT chains_pkey PRIMARY KEY (slug);


--
-- Name: cron_jobs cron_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.cron_jobs
    ADD CONSTRAINT cron_jobs_pkey PRIMARY KEY (id);


--
-- Name: cron_runs cron_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.cron_runs
    ADD CONSTRAINT cron_runs_pkey PRIMARY KEY (id);


--
-- Name: ingestion_chunks ingestion_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_chunks
    ADD CONSTRAINT ingestion_chunks_pkey PRIMARY KEY (id);


--
-- Name: ingestion_errors ingestion_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors
    ADD CONSTRAINT ingestion_errors_pkey PRIMARY KEY (id);


--
-- Name: ingestion_file_entries ingestion_file_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_file_entries
    ADD CONSTRAINT ingestion_file_entries_pkey PRIMARY KEY (id);


--
-- Name: ingestion_files ingestion_files_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_files
    ADD CONSTRAINT ingestion_files_pkey PRIMARY KEY (id);


--
-- Name: ingestion_runs ingestion_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_runs
    ADD CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id);


--
-- Name: ingestion_store_stats ingestion_store_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_store_stats
    ADD CONSTRAINT ingestion_store_stats_pkey PRIMARY KEY (id);


--
-- Name: passkey passkey_credentialID_unique; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT "passkey_credentialID_unique" UNIQUE ("credentialID");


--
-- Name: passkey passkey_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT passkey_pkey PRIMARY KEY (id);


--
-- Name: price_groups price_groups_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.price_groups
    ADD CONSTRAINT price_groups_pkey PRIMARY KEY (id);


--
-- Name: product_aliases product_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_aliases
    ADD CONSTRAINT product_aliases_pkey PRIMARY KEY (id);


--
-- Name: product_links product_links_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_links
    ADD CONSTRAINT product_links_pkey PRIMARY KEY (id);


--
-- Name: product_match_audit product_match_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_audit
    ADD CONSTRAINT product_match_audit_pkey PRIMARY KEY (id);


--
-- Name: product_match_candidates product_match_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_candidates
    ADD CONSTRAINT product_match_candidates_pkey PRIMARY KEY (id);


--
-- Name: product_match_queue product_match_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_queue
    ADD CONSTRAINT product_match_queue_pkey PRIMARY KEY (id);


--
-- Name: product_relations product_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_relations
    ADD CONSTRAINT product_relations_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: retailer_item_barcodes retailer_item_barcodes_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_item_barcodes
    ADD CONSTRAINT retailer_item_barcodes_pkey PRIMARY KEY (id);


--
-- Name: retailer_items_failed retailer_items_failed_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_items_failed
    ADD CONSTRAINT retailer_items_failed_pkey PRIMARY KEY (id);


--
-- Name: retailer_items retailer_items_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_items
    ADD CONSTRAINT retailer_items_pkey PRIMARY KEY (id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_unique; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT session_token_unique UNIQUE (token);


--
-- Name: store_enrichment_tasks store_enrichment_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_enrichment_tasks
    ADD CONSTRAINT store_enrichment_tasks_pkey PRIMARY KEY (id);


--
-- Name: store_group_history store_group_history_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_group_history
    ADD CONSTRAINT store_group_history_pkey PRIMARY KEY (id);


--
-- Name: store_identifiers store_identifiers_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_identifiers
    ADD CONSTRAINT store_identifiers_pkey PRIMARY KEY (id);


--
-- Name: store_item_price_periods store_item_price_periods_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_price_periods
    ADD CONSTRAINT store_item_price_periods_pkey PRIMARY KEY (id);


--
-- Name: store_item_state store_item_state_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_state
    ADD CONSTRAINT store_item_state_pkey PRIMARY KEY (id);


--
-- Name: stores stores_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_pkey PRIMARY KEY (id);


--
-- Name: task_queue task_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.task_queue
    ADD CONSTRAINT task_queue_pkey PRIMARY KEY (id);


--
-- Name: todos todos_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.todos
    ADD CONSTRAINT todos_pkey PRIMARY KEY (id);


--
-- Name: user user_email_unique; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_email_unique UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: verification verification_pkey; Type: CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);


--
-- Name: canonical_barcodes_product_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX canonical_barcodes_product_id_idx ON public.canonical_barcodes USING btree (product_id);


--
-- Name: cron_jobs_enabled_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX cron_jobs_enabled_idx ON public.cron_jobs USING btree (enabled);


--
-- Name: cron_jobs_next_run_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX cron_jobs_next_run_idx ON public.cron_jobs USING btree (next_run_at) WHERE (enabled = true);


--
-- Name: cron_runs_idempotency_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX cron_runs_idempotency_idx ON public.cron_runs USING btree (idempotency_key);


--
-- Name: cron_runs_job_created_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX cron_runs_job_created_idx ON public.cron_runs USING btree (job_id, created_at);


--
-- Name: cron_runs_job_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX cron_runs_job_id_idx ON public.cron_runs USING btree (job_id);


--
-- Name: cron_runs_status_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX cron_runs_status_idx ON public.cron_runs USING btree (status);


--
-- Name: group_prices_pkey; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX group_prices_pkey ON public.group_prices USING btree (price_group_id, retailer_item_id);


--
-- Name: group_prices_price_group_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX group_prices_price_group_id_idx ON public.group_prices USING btree (price_group_id);


--
-- Name: group_prices_retailer_item_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX group_prices_retailer_item_id_idx ON public.group_prices USING btree (retailer_item_id);


--
-- Name: idx_archives_chain_downloaded; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_archives_chain_downloaded ON public.archives USING btree (chain_slug, downloaded_at);


--
-- Name: idx_archives_chain_slug; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_archives_chain_slug ON public.archives USING btree (chain_slug);


--
-- Name: idx_archives_checksum; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_archives_checksum ON public.archives USING btree (checksum);


--
-- Name: idx_archives_downloaded_at; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_archives_downloaded_at ON public.archives USING btree (downloaded_at);


--
-- Name: idx_ingestion_runs_active; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_ingestion_runs_active ON public.ingestion_runs USING btree (chain_slug, target_date, status);


--
-- Name: idx_ingestion_runs_archive_id; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_ingestion_runs_archive_id ON public.ingestion_runs USING btree (archive_id);


--
-- Name: idx_ingestion_runs_chain_date; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_ingestion_runs_chain_date ON public.ingestion_runs USING btree (chain_slug, target_date);


--
-- Name: idx_retailer_items_archive_id; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_retailer_items_archive_id ON public.retailer_items USING btree (archive_id);


--
-- Name: idx_task_queue_scheduled; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_task_queue_scheduled ON public.task_queue USING btree (scheduled_for);


--
-- Name: idx_task_queue_status; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_task_queue_status ON public.task_queue USING btree (status);


--
-- Name: idx_task_queue_type_priority; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_task_queue_type_priority ON public.task_queue USING btree (task_type, priority, scheduled_for);


--
-- Name: idx_task_queue_worker; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX idx_task_queue_worker ON public.task_queue USING btree (worker_id);


--
-- Name: ingestion_chunks_file_chunk_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX ingestion_chunks_file_chunk_idx ON public.ingestion_chunks USING btree (file_id, chunk_index);


--
-- Name: ingestion_chunks_status_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX ingestion_chunks_status_idx ON public.ingestion_chunks USING btree (status);


--
-- Name: ingestion_store_stats_file_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX ingestion_store_stats_file_idx ON public.ingestion_store_stats USING btree (file_id);


--
-- Name: ingestion_store_stats_run_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX ingestion_store_stats_run_idx ON public.ingestion_store_stats USING btree (run_id);


--
-- Name: ingestion_store_stats_store_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX ingestion_store_stats_store_idx ON public.ingestion_store_stats USING btree (store_id);


--
-- Name: pmc_item_candidate_uniq; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX pmc_item_candidate_uniq ON public.product_match_candidates USING btree (retailer_item_id, candidate_product_id);


--
-- Name: pmc_item_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX pmc_item_idx ON public.product_match_candidates USING btree (retailer_item_id);


--
-- Name: pmc_item_rank_uniq; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX pmc_item_rank_uniq ON public.product_match_candidates USING btree (retailer_item_id, rank);


--
-- Name: pmc_type_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX pmc_type_idx ON public.product_match_candidates USING btree (match_type);


--
-- Name: pmq_item_uniq; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX pmq_item_uniq ON public.product_match_queue USING btree (retailer_item_id);


--
-- Name: pmq_status_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX pmq_status_idx ON public.product_match_queue USING btree (status);


--
-- Name: price_groups_chain_hash_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX price_groups_chain_hash_unique ON public.price_groups USING btree (chain_slug, price_hash, hash_version);


--
-- Name: price_groups_chain_slug_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX price_groups_chain_slug_idx ON public.price_groups USING btree (chain_slug);


--
-- Name: price_groups_last_seen_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX price_groups_last_seen_idx ON public.price_groups USING btree (last_seen_at);


--
-- Name: price_groups_price_hash_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX price_groups_price_hash_idx ON public.price_groups USING btree (price_hash);


--
-- Name: price_groups_store_count_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX price_groups_store_count_idx ON public.price_groups USING btree (store_count);


--
-- Name: product_links_item_uniq; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX product_links_item_uniq ON public.product_links USING btree (retailer_item_id);


--
-- Name: product_links_product_retailer_item_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX product_links_product_retailer_item_unique ON public.product_links USING btree (product_id, retailer_item_id);


--
-- Name: product_match_audit_action_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX product_match_audit_action_idx ON public.product_match_audit USING btree (action);


--
-- Name: product_match_audit_queue_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX product_match_audit_queue_id_idx ON public.product_match_audit USING btree (queue_id);


--
-- Name: product_match_rejections_pk; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX product_match_rejections_pk ON public.product_match_rejections USING btree (retailer_item_id, rejected_product_id);


--
-- Name: retailer_item_barcodes_barcode_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX retailer_item_barcodes_barcode_idx ON public.retailer_items USING btree (barcode);


--
-- Name: retailer_item_barcodes_barcode_new_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX retailer_item_barcodes_barcode_new_idx ON public.retailer_item_barcodes USING btree (barcode);


--
-- Name: retailer_item_barcodes_item_barcode_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX retailer_item_barcodes_item_barcode_unique ON public.retailer_item_barcodes USING btree (retailer_item_id, barcode);


--
-- Name: retailer_item_barcodes_retailer_item_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX retailer_item_barcodes_retailer_item_id_idx ON public.retailer_item_barcodes USING btree (retailer_item_id);


--
-- Name: retailer_items_chain_slug_external_id_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX retailer_items_chain_slug_external_id_unique ON public.retailer_items USING btree (chain_slug, external_id);


--
-- Name: store_enrichment_tasks_status_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_enrichment_tasks_status_idx ON public.store_enrichment_tasks USING btree (status);


--
-- Name: store_enrichment_tasks_store_type_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_enrichment_tasks_store_type_idx ON public.store_enrichment_tasks USING btree (store_id, type);


--
-- Name: store_group_history_current; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX store_group_history_current ON public.store_group_history USING btree (store_id) WHERE (valid_to IS NULL);


--
-- Name: store_group_history_price_group_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_group_history_price_group_id_idx ON public.store_group_history USING btree (price_group_id);


--
-- Name: store_group_history_store_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_group_history_store_id_idx ON public.store_group_history USING btree (store_id);


--
-- Name: store_group_history_valid_from_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_group_history_valid_from_idx ON public.store_group_history USING btree (valid_from);


--
-- Name: store_identifiers_store_type_value_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX store_identifiers_store_type_value_unique ON public.store_identifiers USING btree (store_id, type, value);


--
-- Name: store_identifiers_type_value_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_identifiers_type_value_idx ON public.store_identifiers USING btree (type, value);


--
-- Name: store_item_price_periods_state_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_item_price_periods_state_idx ON public.store_item_price_periods USING btree (store_item_state_id);


--
-- Name: store_item_price_periods_time_range_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_item_price_periods_time_range_idx ON public.store_item_price_periods USING btree (started_at, ended_at);


--
-- Name: store_item_state_last_seen_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_item_state_last_seen_idx ON public.store_item_state USING btree (last_seen_at);


--
-- Name: store_item_state_price_signature_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_item_state_price_signature_idx ON public.store_item_state USING btree (price_signature);


--
-- Name: store_item_state_store_retailer_unique; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX store_item_state_store_retailer_unique ON public.store_item_state USING btree (store_id, retailer_item_id);


--
-- Name: store_price_exceptions_expires_at_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_price_exceptions_expires_at_idx ON public.store_price_exceptions USING btree (expires_at);


--
-- Name: store_price_exceptions_pkey; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE UNIQUE INDEX store_price_exceptions_pkey ON public.store_price_exceptions USING btree (store_id, retailer_item_id);


--
-- Name: store_price_exceptions_retailer_item_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_price_exceptions_retailer_item_id_idx ON public.store_price_exceptions USING btree (retailer_item_id);


--
-- Name: store_price_exceptions_store_id_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX store_price_exceptions_store_id_idx ON public.store_price_exceptions USING btree (store_id);


--
-- Name: stores_approved_by_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX stores_approved_by_idx ON public.stores USING btree (approved_by);


--
-- Name: stores_chain_slug_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX stores_chain_slug_idx ON public.stores USING btree (chain_slug);


--
-- Name: stores_city_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX stores_city_idx ON public.stores USING btree (city);


--
-- Name: stores_price_source_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX stores_price_source_idx ON public.stores USING btree (price_source_store_id);


--
-- Name: stores_status_idx; Type: INDEX; Schema: public; Owner: kosarica
--

CREATE INDEX stores_status_idx ON public.stores USING btree (status);


--
-- Name: account account_userId_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.account
    ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: canonical_barcodes canonical_barcodes_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.canonical_barcodes
    ADD CONSTRAINT canonical_barcodes_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: cron_runs cron_runs_job_id_cron_jobs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.cron_runs
    ADD CONSTRAINT cron_runs_job_id_cron_jobs_id_fk FOREIGN KEY (job_id) REFERENCES public.cron_jobs(id) ON DELETE CASCADE;


--
-- Name: group_prices group_prices_price_group_id_price_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.group_prices
    ADD CONSTRAINT group_prices_price_group_id_price_groups_id_fk FOREIGN KEY (price_group_id) REFERENCES public.price_groups(id) ON DELETE CASCADE;


--
-- Name: group_prices group_prices_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.group_prices
    ADD CONSTRAINT group_prices_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: ingestion_chunks ingestion_chunks_file_id_ingestion_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_chunks
    ADD CONSTRAINT ingestion_chunks_file_id_ingestion_files_id_fk FOREIGN KEY (file_id) REFERENCES public.ingestion_files(id) ON DELETE CASCADE;


--
-- Name: ingestion_errors ingestion_errors_chunk_id_ingestion_chunks_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors
    ADD CONSTRAINT ingestion_errors_chunk_id_ingestion_chunks_id_fk FOREIGN KEY (chunk_id) REFERENCES public.ingestion_chunks(id) ON DELETE SET NULL;


--
-- Name: ingestion_errors ingestion_errors_entry_id_ingestion_file_entries_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors
    ADD CONSTRAINT ingestion_errors_entry_id_ingestion_file_entries_id_fk FOREIGN KEY (entry_id) REFERENCES public.ingestion_file_entries(id) ON DELETE SET NULL;


--
-- Name: ingestion_errors ingestion_errors_file_id_ingestion_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors
    ADD CONSTRAINT ingestion_errors_file_id_ingestion_files_id_fk FOREIGN KEY (file_id) REFERENCES public.ingestion_files(id) ON DELETE SET NULL;


--
-- Name: ingestion_errors ingestion_errors_run_id_ingestion_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_errors
    ADD CONSTRAINT ingestion_errors_run_id_ingestion_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.ingestion_runs(id) ON DELETE CASCADE;


--
-- Name: ingestion_file_entries ingestion_file_entries_file_id_ingestion_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_file_entries
    ADD CONSTRAINT ingestion_file_entries_file_id_ingestion_files_id_fk FOREIGN KEY (file_id) REFERENCES public.ingestion_files(id) ON DELETE CASCADE;


--
-- Name: ingestion_files ingestion_files_run_id_ingestion_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_files
    ADD CONSTRAINT ingestion_files_run_id_ingestion_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.ingestion_runs(id) ON DELETE CASCADE;


--
-- Name: ingestion_runs ingestion_runs_archive_id_archives_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_runs
    ADD CONSTRAINT ingestion_runs_archive_id_archives_id_fk FOREIGN KEY (archive_id) REFERENCES public.archives(id) ON DELETE SET NULL;


--
-- Name: ingestion_runs ingestion_runs_chain_slug_chains_slug_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_runs
    ADD CONSTRAINT ingestion_runs_chain_slug_chains_slug_fk FOREIGN KEY (chain_slug) REFERENCES public.chains(slug) ON DELETE CASCADE;


--
-- Name: ingestion_store_stats ingestion_store_stats_file_id_ingestion_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_store_stats
    ADD CONSTRAINT ingestion_store_stats_file_id_ingestion_files_id_fk FOREIGN KEY (file_id) REFERENCES public.ingestion_files(id) ON DELETE CASCADE;


--
-- Name: ingestion_store_stats ingestion_store_stats_run_id_ingestion_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_store_stats
    ADD CONSTRAINT ingestion_store_stats_run_id_ingestion_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.ingestion_runs(id) ON DELETE CASCADE;


--
-- Name: ingestion_store_stats ingestion_store_stats_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.ingestion_store_stats
    ADD CONSTRAINT ingestion_store_stats_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: passkey passkey_userId_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.passkey
    ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: price_groups price_groups_chain_slug_chains_slug_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.price_groups
    ADD CONSTRAINT price_groups_chain_slug_chains_slug_fk FOREIGN KEY (chain_slug) REFERENCES public.chains(slug) ON DELETE CASCADE;


--
-- Name: product_aliases product_aliases_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_aliases
    ADD CONSTRAINT product_aliases_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_links product_links_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_links
    ADD CONSTRAINT product_links_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_links product_links_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_links
    ADD CONSTRAINT product_links_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: product_match_audit product_match_audit_queue_id_product_match_queue_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_audit
    ADD CONSTRAINT product_match_audit_queue_id_product_match_queue_id_fk FOREIGN KEY (queue_id) REFERENCES public.product_match_queue(id) ON DELETE CASCADE;


--
-- Name: product_match_audit product_match_audit_user_id_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_audit
    ADD CONSTRAINT product_match_audit_user_id_user_id_fk FOREIGN KEY (user_id) REFERENCES public."user"(id);


--
-- Name: product_match_candidates product_match_candidates_candidate_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_candidates
    ADD CONSTRAINT product_match_candidates_candidate_product_id_products_id_fk FOREIGN KEY (candidate_product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_match_candidates product_match_candidates_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_candidates
    ADD CONSTRAINT product_match_candidates_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: product_match_queue product_match_queue_linked_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_queue
    ADD CONSTRAINT product_match_queue_linked_product_id_products_id_fk FOREIGN KEY (linked_product_id) REFERENCES public.products(id);


--
-- Name: product_match_queue product_match_queue_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_queue
    ADD CONSTRAINT product_match_queue_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: product_match_queue product_match_queue_reviewed_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_queue
    ADD CONSTRAINT product_match_queue_reviewed_by_user_id_fk FOREIGN KEY (reviewed_by) REFERENCES public."user"(id);


--
-- Name: product_match_rejections product_match_rejections_rejected_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_rejections
    ADD CONSTRAINT product_match_rejections_rejected_by_user_id_fk FOREIGN KEY (rejected_by) REFERENCES public."user"(id);


--
-- Name: product_match_rejections product_match_rejections_rejected_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_rejections
    ADD CONSTRAINT product_match_rejections_rejected_product_id_products_id_fk FOREIGN KEY (rejected_product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_match_rejections product_match_rejections_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_match_rejections
    ADD CONSTRAINT product_match_rejections_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: product_relations product_relations_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_relations
    ADD CONSTRAINT product_relations_product_id_products_id_fk FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_relations product_relations_related_product_id_products_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.product_relations
    ADD CONSTRAINT product_relations_related_product_id_products_id_fk FOREIGN KEY (related_product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: retailer_item_barcodes retailer_item_barcodes_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_item_barcodes
    ADD CONSTRAINT retailer_item_barcodes_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: retailer_items retailer_items_archive_id_archives_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_items
    ADD CONSTRAINT retailer_items_archive_id_archives_id_fk FOREIGN KEY (archive_id) REFERENCES public.archives(id) ON DELETE SET NULL;


--
-- Name: retailer_items_failed retailer_items_failed_file_id_ingestion_files_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_items_failed
    ADD CONSTRAINT retailer_items_failed_file_id_ingestion_files_id_fk FOREIGN KEY (file_id) REFERENCES public.ingestion_files(id) ON DELETE CASCADE;


--
-- Name: retailer_items_failed retailer_items_failed_run_id_ingestion_runs_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.retailer_items_failed
    ADD CONSTRAINT retailer_items_failed_run_id_ingestion_runs_id_fk FOREIGN KEY (run_id) REFERENCES public.ingestion_runs(id) ON DELETE CASCADE;


--
-- Name: session session_userId_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.session
    ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES public."user"(id) ON DELETE CASCADE;


--
-- Name: store_enrichment_tasks store_enrichment_tasks_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_enrichment_tasks
    ADD CONSTRAINT store_enrichment_tasks_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_enrichment_tasks store_enrichment_tasks_verified_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_enrichment_tasks
    ADD CONSTRAINT store_enrichment_tasks_verified_by_user_id_fk FOREIGN KEY (verified_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: store_group_history store_group_history_price_group_id_price_groups_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_group_history
    ADD CONSTRAINT store_group_history_price_group_id_price_groups_id_fk FOREIGN KEY (price_group_id) REFERENCES public.price_groups(id) ON DELETE CASCADE;


--
-- Name: store_group_history store_group_history_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_group_history
    ADD CONSTRAINT store_group_history_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_identifiers store_identifiers_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_identifiers
    ADD CONSTRAINT store_identifiers_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_item_price_periods store_item_price_periods_store_item_state_id_store_item_state_i; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_price_periods
    ADD CONSTRAINT store_item_price_periods_store_item_state_id_store_item_state_i FOREIGN KEY (store_item_state_id) REFERENCES public.store_item_state(id) ON DELETE CASCADE;


--
-- Name: store_item_state store_item_state_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_state
    ADD CONSTRAINT store_item_state_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: store_item_state store_item_state_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_item_state
    ADD CONSTRAINT store_item_state_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: store_price_exceptions store_price_exceptions_created_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_price_exceptions
    ADD CONSTRAINT store_price_exceptions_created_by_user_id_fk FOREIGN KEY (created_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: store_price_exceptions store_price_exceptions_retailer_item_id_retailer_items_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_price_exceptions
    ADD CONSTRAINT store_price_exceptions_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;


--
-- Name: store_price_exceptions store_price_exceptions_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.store_price_exceptions
    ADD CONSTRAINT store_price_exceptions_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;


--
-- Name: stores stores_approved_by_user_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_approved_by_user_id_fk FOREIGN KEY (approved_by) REFERENCES public."user"(id) ON DELETE SET NULL;


--
-- Name: stores stores_chain_slug_chains_slug_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_chain_slug_chains_slug_fk FOREIGN KEY (chain_slug) REFERENCES public.chains(slug) ON DELETE CASCADE;


--
-- Name: stores stores_price_source_store_id_stores_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: kosarica
--

ALTER TABLE ONLY public.stores
    ADD CONSTRAINT stores_price_source_store_id_stores_id_fk FOREIGN KEY (price_source_store_id) REFERENCES public.stores(id);


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: kosarica
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;


--
-- PostgreSQL database dump complete
--

-- ============================================================================
-- Phase 1: Item-Level Price Clustering (price_tiers, store_price_refs)
-- ============================================================================

--
-- Name: price_tiers; Type: TABLE; Schema: public; Owner: kosarica
-- Item-level price groups: unique (item, price, discount) combinations
--

CREATE TABLE public.price_tiers (
    id text PRIMARY KEY DEFAULT 'pt_' || gen_random_uuid()::text,
    chain_slug text NOT NULL,
    retailer_item_id text NOT NULL,
    price integer NOT NULL,
    discount_price integer,
    unit_price integer,
    anchor_price integer,
    first_seen_at timestamp with time zone DEFAULT NOW() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT NOW() NOT NULL,
    store_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT NOW() NOT NULL
);

ALTER TABLE public.price_tiers OWNER TO kosarica;

--
-- Name: store_price_refs; Type: TABLE; Schema: public; Owner: kosarica
-- Lightweight join table: store references to price tiers
--

CREATE TABLE public.store_price_refs (
    store_id text NOT NULL,
    retailer_item_id text NOT NULL,
    price_tier_id text NOT NULL,
    in_stock boolean DEFAULT true,
    last_seen_at timestamp with time zone DEFAULT NOW() NOT NULL,
    PRIMARY KEY (store_id, retailer_item_id)
);

ALTER TABLE public.store_price_refs OWNER TO kosarica;

--
-- Name: price_tiers indexes
--

CREATE INDEX idx_price_tiers_item ON public.price_tiers(retailer_item_id);
CREATE INDEX idx_price_tiers_chain ON public.price_tiers(chain_slug);
CREATE INDEX idx_price_tiers_last_seen ON public.price_tiers(last_seen_at);
CREATE UNIQUE INDEX idx_price_tiers_unique ON public.price_tiers(chain_slug, retailer_item_id, price, COALESCE(discount_price, -1));

--
-- Name: store_price_refs indexes
--

CREATE INDEX idx_store_price_refs_tier ON public.store_price_refs(price_tier_id);
CREATE INDEX idx_store_price_refs_store ON public.store_price_refs(store_id);

--
-- Name: price_tiers foreign keys
--

ALTER TABLE ONLY public.price_tiers
    ADD CONSTRAINT price_tiers_chain_slug_chains_slug_fk FOREIGN KEY (chain_slug) REFERENCES public.chains(slug) ON DELETE CASCADE;

ALTER TABLE ONLY public.price_tiers
    ADD CONSTRAINT price_tiers_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;

--
-- Name: store_price_refs foreign keys
--

ALTER TABLE ONLY public.store_price_refs
    ADD CONSTRAINT store_price_refs_store_id_stores_id_fk FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.store_price_refs
    ADD CONSTRAINT store_price_refs_retailer_item_id_retailer_items_id_fk FOREIGN KEY (retailer_item_id) REFERENCES public.retailer_items(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.store_price_refs
    ADD CONSTRAINT store_price_refs_price_tier_id_price_tiers_id_fk FOREIGN KEY (price_tier_id) REFERENCES public.price_tiers(id) ON DELETE CASCADE;

-- ============================================================================
-- Phase 1: Parent-Child Task Support
-- ============================================================================

--
-- Name: task_queue parent-child columns
--

ALTER TABLE public.task_queue ADD COLUMN IF NOT EXISTS parent_task_id text REFERENCES public.task_queue(id);
ALTER TABLE public.task_queue ADD COLUMN IF NOT EXISTS expected_children integer DEFAULT 0;
ALTER TABLE public.task_queue ADD COLUMN IF NOT EXISTS completed_children integer DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_task_queue_parent ON public.task_queue(parent_task_id) WHERE parent_task_id IS NOT NULL;

--
-- Name: task_queue_status_check; Type: CONSTRAINT; Update to include 'waiting_for_children'
--

ALTER TABLE public.task_queue DROP CONSTRAINT IF EXISTS task_queue_status_check;
ALTER TABLE public.task_queue ADD CONSTRAINT task_queue_status_check
  CHECK (status = ANY (ARRAY['pending'::text, 'claimed'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'waiting_for_children'::text]));

--
-- Name: on_subtask_complete(); Type: FUNCTION; Schema: public
-- Trigger function to handle subtask completion and wake parent tasks
--

CREATE OR REPLACE FUNCTION public.on_subtask_complete() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND NEW.parent_task_id IS NOT NULL THEN
    -- Increment parent's completed_children counter
    UPDATE task_queue
    SET completed_children = completed_children + 1,
        updated_at = NOW()
    WHERE id = NEW.parent_task_id;

    -- Check if parent can proceed (all children completed)
    UPDATE task_queue
    SET status = 'pending', scheduled_for = NOW()
    WHERE id = NEW.parent_task_id
      AND status = 'waiting_for_children'
      AND completed_children >= expected_children;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER FUNCTION public.on_subtask_complete() OWNER TO kosarica;

--
-- Name: subtask_completion_trigger; Type: TRIGGER
--

DROP TRIGGER IF EXISTS subtask_completion_trigger ON public.task_queue;
CREATE TRIGGER subtask_completion_trigger
  AFTER UPDATE OF status ON public.task_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.on_subtask_complete();


