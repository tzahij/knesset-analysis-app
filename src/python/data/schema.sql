-- PostgreSQL Schema Definition for Israeli Knesset Data Repository

-- 1. Parties (Normalized)
CREATE TABLE IF NOT EXISTS party (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    start_date DATE,
    end_date DATE,
    logo_url VARCHAR(2048)
);

-- 2. Members
CREATE TABLE IF NOT EXISTS member (
    slug VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    party_id INTEGER REFERENCES party(id) ON DELETE SET NULL,
    contacts JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2b. Member Analysis (1-1 with member, populated by the analysis batch)
CREATE TABLE IF NOT EXISTS member_analysis (
    member_slug VARCHAR(255) PRIMARY KEY REFERENCES member(slug) ON DELETE CASCADE,
    analysis_summary JSONB,
    analysis_model VARCHAR(255),
    last_analyzed_at TIMESTAMP WITH TIME ZONE,  -- When last analysis was run
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Laws
CREATE TABLE IF NOT EXISTS law (
    bill_id VARCHAR(50) PRIMARY KEY,
    title TEXT NOT NULL,
    publication_date DATE NOT NULL,
    knesset_number INTEGER,
    status VARCHAR(50) DEFAULT 'pending_analysis',
    vote_match_status VARCHAR(20) DEFAULT 'pending', -- Used by the votes scraper to know if it has matched votes
    url VARCHAR(2048),
    local_file_path VARCHAR(2048),
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    summary_law TEXT,
    analysis_summary JSONB, -- To store the Gemini analysis results natively
    analysis_model VARCHAR(255),
    parsed_text TEXT -- Extracted text from the local file
);

CREATE INDEX idx_law_publication_date ON law(publication_date);
CREATE INDEX idx_law_status ON law(status);

-- 4. Vote Events (The headers of the votes, linked to Laws)
CREATE TABLE IF NOT EXISTS vote_event (
    vote_id VARCHAR(50) PRIMARY KEY,
    bill_id VARCHAR(50) REFERENCES law(bill_id) ON DELETE CASCADE,
    item_title TEXT NOT NULL,
    decision TEXT,
    accepted_text TEXT,
    chairman_name VARCHAR(255),
    session_number INTEGER,
    is_for_accepted BOOLEAN,
    vote_date TIMESTAMP WITH TIME ZONE NOT NULL,
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_vote_event_bill_id ON vote_event(bill_id);
CREATE INDEX idx_vote_event_date ON vote_event(vote_date);

-- 5. Vote Records (How individual members voted on a specific vote_event)
CREATE TABLE IF NOT EXISTS vote_record (
    id SERIAL PRIMARY KEY,
    vote_id VARCHAR(50) REFERENCES vote_event(vote_id) ON DELETE CASCADE,
    member_slug VARCHAR(255) REFERENCES member(slug) ON DELETE CASCADE,
    vote_type VARCHAR(20) NOT NULL CHECK (vote_type IN ('for', 'against', 'abstained', 'present')),
    UNIQUE(vote_id, member_slug) -- Creates a unique constraint and implicit B-Tree index
);

CREATE INDEX idx_vote_record_member ON vote_record(member_slug);

-- 6. Protocols (Both Plenum and Committee)
CREATE TABLE IF NOT EXISTS protocol (
    document_id VARCHAR(50) PRIMARY KEY,
    source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('plenum', 'committee')), 
    knesset_number INTEGER,
    protocol_date DATE NOT NULL,
    session_number INTEGER,
    committee_name VARCHAR(255), -- NULL if plenum
    committee_type_description VARCHAR(255),
    url VARCHAR(2048),  
    local_file_path VARCHAR(2048),
    status VARCHAR(50) DEFAULT 'pending_analysis',
    last_updated_date TIMESTAMP, -- The OData API's last updated timestamp, used for delta syncing
    fetched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    has_extracted_utterances BOOLEAN DEFAULT FALSE,
    fact_check_results JSONB, -- To store the Gemini fact-checking results
    analysis_model VARCHAR(255),
    parsed_text TEXT -- Extracted text from the local file
);

CREATE INDEX idx_protocol_date ON protocol(protocol_date);
CREATE INDEX idx_protocol_source ON protocol(source_type);
CREATE INDEX idx_protocol_status ON protocol(status);

-- 7. Law Surprise Explanations
CREATE TABLE IF NOT EXISTS law_surprise_explanation (
    bill_id VARCHAR(50) REFERENCES law(bill_id) ON DELETE CASCADE,
    member_slug VARCHAR(255) REFERENCES member(slug) ON DELETE CASCADE,
    explanation JSONB,
    PRIMARY KEY (bill_id, member_slug)
);

-- 8. Member Utterances
CREATE TABLE IF NOT EXISTS member_utterance (
    id SERIAL PRIMARY KEY,
    member_slug VARCHAR(255) REFERENCES member(slug) ON DELETE CASCADE,
    protocol_id VARCHAR(50) REFERENCES protocol(document_id) ON DELETE CASCADE,
    utterance_text TEXT NOT NULL,
    word_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 9. Files Storage
CREATE TABLE IF NOT EXISTS file (
    entity_type VARCHAR(1), -- 'P' for plenum, 'C' for committee, 'L' for law
    id VARCHAR(50),       -- document_id or bill_id
    file_type VARCHAR(10), -- 'pdf', 'doc', 'docx'
    file BYTEA,
    PRIMARY KEY (entity_type, id)
);
