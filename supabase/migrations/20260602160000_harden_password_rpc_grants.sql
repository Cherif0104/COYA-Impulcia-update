-- PB4/PB5 — Durcissement des droits d'exécution des RPC liées aux mots de passe.
--
-- Les advisors de sécurité signalent que des fonctions SECURITY DEFINER sont exécutables par
-- le rôle `anon`. On restreint l'exécution au strict nécessaire :
--   * `clear_provisional_password()`     : appelée par l'UTILISATEUR connecté après avoir changé
--     son mot de passe → réservée à `authenticated` (jamais `anon`).
--   * `store_provisional_password(...)`  : réservée aux ADMINS (vérif. interne) mais ne doit pas
--     être exposée à `anon` → réservée à `authenticated`.
--   * `request_password_reset(text)`     : INTENTIONNELLEMENT exécutable par `anon` (page de
--     connexion, utilisateur non authentifié). On la laisse accessible à `anon` + `authenticated`.
--
-- Note : ces fonctions restent SECURITY DEFINER (nécessaire pour écrire dans des tables protégées
-- par RLS) ; chacune revalide en interne l'identité/le rôle de l'appelant (`auth.uid()`).

REVOKE EXECUTE ON FUNCTION public.clear_provisional_password() FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_provisional_password(uuid, text, uuid, text) FROM anon;

-- (request_password_reset conserve volontairement l'exécution anon : récupération self-service.)
