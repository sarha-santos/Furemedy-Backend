--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id integer NOT NULL,
    first_name character varying(255) NOT NULL,
    last_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    mobile_number character varying(20),
    password character varying(255),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    profile_image_path character varying(255),
    about_me text,
    is_verified boolean DEFAULT false,
    security_question text,
    security_answer text,
    reset_token text,
    reset_token_expires_at timestamp without time zone
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.users_id_seq OWNER TO postgres;

--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--
INSERT INTO public.users (
id,
first_name,
last_name,
email,
mobile_number,
password,
created_at,
profile_image_path,
about_me,
is_verified,
security_question,
security_answer,
reset_token,
reset_token_expires_at
) VALUES
(
2,
'Andrue',
'Acusin',
'andruebilat@gmail.com',
'9876543210',
'$2b$10$QrL1HR1GXNNQ6Tfu/.g2me/FtMIYe5MtpNI1UpERSsNhPHT3FzFXK',
'2025-09-24 16:46:35.980793+08',
'uploads\\profileImage-1758703595804.jpeg',
NULL,
false,
NULL,
NULL,
NULL,
NULL
),
(
8,
'Sarha',
'Santos',
'sarahmaysnts13@gmail.com',
NULL,
NULL,
'2025-09-26 23:18:50.775242+08',
'https://lh3.googleusercontent.com/a/ACg8ocLhuDjf_-SQu6ba8kVvPvwZKlioFUphSOnZWezQ9unZmBcKDG7A=s96-c',
NULL,
false,
NULL,
NULL,
NULL,
NULL
),
(
13,
'Aiah',
'Arceta',
'sarhamay.santos@tup.edu.ph',
'9708172882',
'$2b$10$xfWH4E9B47/tO.1Mw5aZD.P6oTwvPOh2KHFOKApxeOojLfopGSmjy',
'2025-09-29 19:47:43.911337+08',
'uploads\\profileImage-1759146463671.jpeg',
NULL,
false,
NULL,
NULL,
NULL,
NULL
),
(
14,
'Arvin',
'Ibarra',
'hevarvin@gmail.com',
'9290085543',
'$2b$10$Cex9Vesfk8AMsXqt7qgUhuybsAIS3Q5Z633EBbitG.w0iyS43jzNe',
'2025-10-11 18:56:17.984886+08',
'uploads\\profileImage-1760180177493.jpeg',
NULL,
true,
'What was your first pet''s name?',
'$2b$10$1wVhpuuA9MeAFr6dhThsEeufKsGlmp.b9Ykxag6LPbKrGscJGM15.',
'f188792fb088b0070c74702277863b54deee5461cf00912b367fb063745feb5e',
'2025-11-19 19:03:01.457'
),
(
15,
'Rohann',
'Dranto',
'rohann.dranto@gmail.com',
'9843484073',
'$2b$10$j438ykZtE/7JmERnDyYU5.T9v8jSQ/kZWvwVH.w8mxNTs.maoj3/e',
'2025-10-11 21:28:28.083699+08',
'uploads\\profileImage-1760189307788.jpeg',
NULL,
true,
'What was your first pet''s name?',
'$2b$10$j438ykZtE/7JmERnDyYU5.MOQgtdz3H2JcYsWDsV1xhjsxY3xeq2K',
NULL,
NULL
);

--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.users_id_seq', 15, true);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);

-- Sequence and defined type
CREATE SEQUENCE IF NOT EXISTS diagnosis_history_id_seq;

-- Table Definition
CREATE TABLE public.diagnosis_history (
    id SERIAL PRIMARY KEY,
    user_name varchar,
    pet_name varchar,
    pet_breed varchar,
    pet_age varchar,
    diagnosis_name varchar,
    severity_level varchar,
    ai_results jsonb,
    user_symptoms jsonb,
    created_at timestamp DEFAULT CURRENT_TIMESTAMP,
    image_uri text
);
--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--


