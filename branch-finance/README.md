# ფილიალის დღიური ფინანსური ანგარიში

React + Vite + Supabase, ჰოსტინგი Vercel-ზე. ჩეკის წაკითხვა: `api/read-receipt.ts` (OpenRouter vision მოდელი).

## გაშვება
1. Supabase-ში შექმენით პროექტი და SQL Editor-ში გაუშვით `supabase/schema.sql`.
2. Vercel-ზე დააიმპორტეთ რეპო, **Root Directory = `branch-finance`**.
3. Vercel → Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `OPENROUTER_API_KEY`, `RECEIPT_MODEL`.
4. ლოკალურად: `cp .env.example .env.local`, `npm install`, `npm run dev` (ჩეკის წაკითხვა მუშაობს მხოლოდ `vercel dev`-ით).

## წესები
- უნდა მქონდეს = წინა დღის „მაქვს“ + ნავაჭრი − TBC − BOG − KEEPZ − ჩეკები − უსაბუთო − ხელფასები − გაცემული + მიღებული.
- შედეგი = რეალურად მაქვს − უნდა მქონდეს.
- მენეჯერი გაგზავნის შემდეგ ვეღარ ასწორებს; ადმინი აბრუნებს „მონახაზში“.

## ⚠ უსაფრთხოება
პაროლები ჯერ არ არის. `schema.sql`-ის პოლისები anon როლს სრულ წვდომას აძლევს, `/admin` ღიაა.
გამოქვეყნებამდე აუცილებლად დაამატეთ ავტორიზაცია და გააკაცრეთ RLS.
