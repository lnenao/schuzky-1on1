# Schůzky 1na1

Rezervace schůzek 1na1 na Netlify. Kolegové si vybírají z vypsaných termínů, správa je na `/admin.html`.

## Stránky

| Adresa | Pro koho |
|---|---|
| `/` | odkaz pro kolegy, výběr volného termínu |
| `/sprava.html?t=…` | odkaz z e-mailu, zrušení nebo přesun vlastní schůzky |
| `/admin.html` | správa termínů a rezervací (heslo) |

## Pravidla

* schůzka trvá 30 minut, místo se bere z proměnné `MEETING_PLACE`
* rezervace a přesun na nový termín nejpozději 24 hodin předem
* zrušení nejpozději 1 hodinu předem
* jeden e-mail může mít jen jednu nadcházející schůzku
* kolega dostává e-mail s pozvánkou do kalendáře při rezervaci, přesunu a zrušení, připomínku 24 hodin předem
* v administraci lze termíny přidávat zadáním rozsahu (třeba úterý 8 až 17) a mezery mezi schůzkami, časy se dopočítají samy, i opakovaně po týdnech, mazat, měnit čas, zapsat kolegu ručně, opravit jméno či e-mail, přesunout a zrušit rezervaci; e-mail kolegovi se dá vypnout zaškrtávátkem

Pravidla se mění v `netlify/lib/core.mjs` (konstanty nahoře).

## Nasazení

1. **Heslo aplikace pro Gmail.** V Google účtu musí být zapnuté dvoufázové ověření. Na https://myaccount.google.com/apppasswords vytvoř heslo aplikace (název třeba „Schůzky 1na1“) a zkopíruj 16 znaků.
2. **GitHub.** Vytvoř nový soukromý repozitář a nahraj do něj obsah této složky (bez `node_modules`).
3. **Netlify.** Add new site → Import an existing project → GitHub → vyber repozitář. Nastavení buildu se načte z `netlify.toml`, nic neměň a dej Deploy.
4. **Proměnné.** Site configuration → Environment variables → přidej:

   | Klíč | Hodnota |
   |---|---|
   | `ADMIN_PASSWORD` | heslo do administrace |
   | `GMAIL_USER` | lnena.o@gmail.com |
   | `GMAIL_APP_PASSWORD` | heslo aplikace z kroku 1 |
   | `OWNER_NAME` | Ondřej Lněnička |
   | `MEETING_PLACE` | ředitelna |
   | `PODKLAD_FORM_URL` | odkaz na Google formulář s podkladem k rozhovoru |
| `SITE_URL` | jen pokud používáš vlastní doménu, např. https://schuzky.mrackova.cz |

5. **Podklad v PDF.** Ulož PDF s podkladem k rozhovoru do složky `public` pod názvem `podklad.pdf`. Kolegové, kteří zvolí papír, ho dostanou v příloze potvrzení.
6. **Znovu nasadit.** Deploys → Trigger deploy → Deploy site (proměnné se projeví až po novém nasazení).
7. Otevři `/admin.html`, přihlas se, vypiš termíny a kolegům pošli hlavní adresu webu.

Data se ukládají do Netlify Blobs (součást webu, nic dalšího se nezakládá). Připomínky posílá naplánovaná funkce `reminders` každou hodinu, její běh je vidět v Netlify v Logs → Functions.

Gmail má limit zhruba 500 e-mailů denně, pro 1na1 schůzky je to bohatě dost.
