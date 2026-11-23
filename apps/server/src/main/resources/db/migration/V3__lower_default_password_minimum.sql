UPDATE password_policy
SET min_length = 8
WHERE id = 1
  AND min_length = 12
  AND NOT (require_uppercase OR require_lowercase OR require_digit OR require_special);
