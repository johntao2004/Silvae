DELETE FROM metadata_provider_settings WHERE provider_id = 'GOOGLE_BOOKS';
DELETE FROM metadata_lookup_cache WHERE provider = 'GOOGLE_BOOKS';

ALTER TABLE metadata_provider_settings
    DROP CONSTRAINT IF EXISTS metadata_provider_settings_provider_id_check;
ALTER TABLE metadata_provider_settings
    ADD CONSTRAINT metadata_provider_settings_provider_id_check
    CHECK (provider_id IN ('OPEN_LIBRARY', 'WIKIDATA'));

UPDATE book_cover_assets SET source = 'CUSTOM' WHERE source = 'GOOGLE_BOOKS';
ALTER TABLE book_cover_assets
    DROP CONSTRAINT IF EXISTS book_cover_assets_source_check;
ALTER TABLE book_cover_assets
    ADD CONSTRAINT book_cover_assets_source_check
    CHECK (source IN ('OPEN_LIBRARY', 'CUSTOM'));
