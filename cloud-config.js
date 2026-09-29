/* Legatura cu Supabase.
 *
 * Cat timp cele doua valori sunt goale, aplicatia merge exact ca inainte: cont si
 * date numai in browserul curent. Cum le completezi, trece pe conturi adevarate:
 * acelasi email si parola pe orice dispozitiv, cu tradeurile sincronizate.
 *
 * De unde le iei: supabase.com -> proiectul tau -> Project Settings -> API
 *   url      = "Project URL"
 *   anonKey  = cheia "anon" / "public"
 *
 * Cheia asta e facuta sa stea in codul paginii, la vedere - de aia se numeste
 * publica. Ce protejeaza datele e RLS din cloud/schema.sql, care lasa fiecare
 * utilizator sa vada numai randul lui. Deci ruleaza schema.sql inainte.
 *
 * Cheia "service_role" nu are ce cauta aici niciodata - aia trece peste RLS.
 */

window.TJ_CLOUD = {
  url: '',
  anonKey: ''
};
