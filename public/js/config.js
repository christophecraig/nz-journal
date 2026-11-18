// Réglages publics (ces valeurs sont faites pour être visibles dans le navigateur).
// Laisse une valeur vide pour désactiver la fonction correspondante.
export const CONFIG = {
  supabaseUrl: "https://ftaapuxmjuduplaxdaql.supabase.co",
  supabaseAnonKey: "sb_publishable_c3Q3590D4DqS6TJcTa9AtA_b7hCUrYn", // clé publique (jamais la clé secrète)
  google: true, // bouton « Continuer avec Google » (à activer aussi dans Supabase)
  emailPassword: true, // inscription par e-mail + mot de passe, SANS e-mail de confirmation
  goatcounter: "nz-journal", // code GoatCounter (https://nz-journal.goatcounter.com)
  tripStart: "2026-11-15", // arrivée en Nouvelle-Zélande (AAAA-MM-JJ) ; sert au bandeau « Le voyage en chiffres »
  tripEnd: "2026-12-12", // retour (AAAA-MM-JJ) ; laisse vide pour ne pas afficher « Jour X sur N »
};
