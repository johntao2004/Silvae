ALTER TABLE password_policy DROP CONSTRAINT password_policy_min_length_check;

UPDATE password_policy SET min_length = 64 WHERE min_length > 64;

ALTER TABLE password_policy ADD CONSTRAINT password_policy_min_length_check
    CHECK (min_length BETWEEN 8 AND 64);
