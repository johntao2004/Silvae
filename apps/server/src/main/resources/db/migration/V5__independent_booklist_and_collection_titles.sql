CREATE OR REPLACE FUNCTION check_reading_list_title() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    title_key text := reading_list_title_key(NEW.title);
BEGIN
    -- Allow metadata edits to existing records with legacy duplicate titles.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.owner_id = OLD.owner_id AND title_key = reading_list_title_key(OLD.title) THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Keep booklist and article collection titles independent; only enforce uniqueness within each table.
    IF TG_TABLE_NAME = 'booklists' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('booklist-title:' || NEW.owner_id::text, 0));
        IF EXISTS (
            SELECT 1 FROM booklists
            WHERE owner_id = NEW.owner_id AND id IS DISTINCT FROM NEW.id AND reading_list_title_key(title) = title_key
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'HU001', MESSAGE = 'Booklist title already exists';
        END IF;
        RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'article_collections' THEN
        PERFORM pg_advisory_xact_lock(hashtextextended('article-collection-title:' || NEW.owner_id::text, 0));
        IF EXISTS (
            SELECT 1 FROM article_collections
            WHERE owner_id = NEW.owner_id AND id IS DISTINCT FROM NEW.id AND reading_list_title_key(title) = title_key
        ) THEN
            RAISE EXCEPTION USING ERRCODE = 'HU002', MESSAGE = 'Article collection title already exists';
        END IF;
        RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Unsupported table for check_reading_list_title: %', TG_TABLE_NAME;
END;
$$;
