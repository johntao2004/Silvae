CREATE FUNCTION reading_list_title_key(title text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT
RETURN lower(regexp_replace(title, '^[[:space:]]+|[[:space:]]+$', '', 'g'));

CREATE FUNCTION check_reading_list_title() RETURNS trigger
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

    -- Serialize title claims across both tables until the writing transaction ends.
    PERFORM pg_advisory_xact_lock(hashtextextended('reading-list-title:' || NEW.owner_id::text, 0));
    IF EXISTS (
        SELECT 1 FROM booklists
        WHERE owner_id = NEW.owner_id AND reading_list_title_key(title) = title_key
    ) OR EXISTS (
        SELECT 1 FROM article_collections
        WHERE owner_id = NEW.owner_id AND reading_list_title_key(title) = title_key
    ) THEN
        RAISE EXCEPTION USING ERRCODE = 'HU001', MESSAGE = 'Reading list title already exists';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER check_booklist_title
    BEFORE INSERT OR UPDATE OF title, owner_id ON booklists
    FOR EACH ROW EXECUTE FUNCTION check_reading_list_title();

CREATE TRIGGER check_article_collection_title
    BEFORE INSERT OR UPDATE OF title, owner_id ON article_collections
    FOR EACH ROW EXECUTE FUNCTION check_reading_list_title();
