        /****************************************************************
         * ⚙️ MASTER VARIABLE HUB
         *****************************************************************/
        const REGISTRATION_GATE = {
            isOpen: false 
        };

        const PORTAL_TIMELINES = {
            submissionDeadline: "December 31, 2026 23:59:59",
            awardsEventDate: "February 11, 2027 23:59:59",
            deadlineLabelText: "31 Dec 2026",
            eventLabelText: "12 Feb 2027"
        };

        const SITE_IMAGES = {
            mainLogo: "logo nav.png",
            paymentQrCode: "angle.jpg",
            socialInstagram: "—Pngtree—instagram icon vector_8704817.png",
            socialYoutube: "—Pngtree—youtube social media 3d stereo_8704808.png",
            socialFacebook: "—Pngtree—facebook icon facebook logo_3584837.png",
            // Per-section background images — add a file name/path to give that section its own backdrop.
            // Leave as "" to keep the default shared background.
            sectionBgStory: "",
            sectionBgCategories: "",
            sectionBgGallery: "",
            sectionBgRegistration: "",
            sectionBgContact: ""
        };

        let CATEGORY_ITEMS = [];

        const GALLERY_IMAGES = [
            { category: "winners2025", src: "Gallery/display/MRC01071.webp", thumb: "Gallery/thumbs/MRC01071.webp", title: "Best Short Film: 'Bug'", sub: "Winner 2025" },
            { category: "winners2025", src: "Gallery/display/MRC01028.webp", thumb: "Gallery/thumbs/MRC01028.webp", title: "Campus Category: 'Timeless'", sub: "Winner 2025" },
            { category: "winners2026", src: "", thumb: "", title: "To Be Announced", sub: "Coming Soon" },
            { category: "events", src: "Gallery/display/MRC00596.webp", thumb: "Gallery/thumbs/MRC00596.webp", title: "Inauguration", sub: "Inauguration" },
            { category: "events", src: "Gallery/display/MRC00614.webp", thumb: "Gallery/thumbs/MRC00614.webp", title: "Inauguration", sub: "Cinema Hall" },
            { category: "events", src: "Gallery/display/MRC00625.webp", thumb: "Gallery/thumbs/MRC00625.webp", title: "Inauguration", sub: "Cinema Hall" }
        ];

        const APP_CONFIG = {
            // Supabase Edge Function — handles createOrder, verifyOrder, and film submission.
            backendUrl: "https://flwlbraeyyrofkhxnvwt.supabase.co/functions/v1/payment",
            // Cashfree config (NO SECRET KEY HERE — secret lives only in the backend env vars).
            // This MUST match the backend's CASHFREE_ENV: "sandbox" or "production".
            cashfreeMode: "production",
            registrationFee: 1000,
            currency: "INR"
        };

        // Supabase (public anon key — safe for the browser; controlled by RLS).
        const SUPA_URL = "https://flwlbraeyyrofkhxnvwt.supabase.co";
        const SUPA_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2xicmFleXlyb2ZraHhudnd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4MDQzNDEsImV4cCI6MjEwNDM4MDM0MX0.0apM1gnHcYzTSLs0wTfi1fgaNCf0RKbeginWPXg5EbY";

        /****************************************************************
         * ✏️ ABOUT SECTION — Edit card content here
         * eyebrow: small label above heading
         * heading: bold title
         * image: filename of photo to show on right/left
         * text: paragraph content (HTML allowed for <strong> etc.)
         *****************************************************************/
        /****************************************************************
         * ABOUT — four chapters shown on the homepage.
         * Admin → About (when enabled) overrides these; this is the fallback.
         * body: "## Heading", blank line = new paragraph, "- " = list item,
         *       "> " = closing quote, **bold**, *italic*.
         * Facts here come only from the festival's own published copy and
         * the official JAIN Kochi website (jainuniversity.ac.in/kochi).
         *****************************************************************/
        const ABOUT_SECTIONS = [
            {
                key: "awards",
                visible: true,
                kicker: "01 — About the Awards",
                title: "Sharankrishna Short Film Awards",
                subtitle: "Celebrating Stories. Recognising Talent. Inspiring the Next Generation.",
                intro: "A platform created to celebrate the filmmakers, storytellers, performers and technicians whose creativity brings stories to life — bringing emerging campus talent and independent filmmakers onto one stage.",
                image: "https://flwlbraeyyrofkhxnvwt.supabase.co/storage/v1/object/public/gallery/1790155437435_disp_1790139745367_MRC01381.JPG.webp",
                imageAlt: "Filmmakers and guests at the Sharankrishna Short Film Awards",
                imageFit: "cover",
                cta: "Know More",
                linkLabel: "View Award Details",
                linkUrl: "#prizes",
                body: `The Sharankrishna Short Film Awards is organised by Angle Frames in association with JAIN (Deemed-to-be University), Kochi. It exists to recognise meaningful cinema, original voices and filmmaking excellence — and the people who make them possible.

## Our Vision
To give every honest, well-told story a stage — and to celebrate the filmmakers behind it, whether they are making their first film on campus or their next one as independent professionals.

## Why Short-Form Cinema
Short films are often where filmmakers first find their voice. They demand clarity and courage: a complete story, told with economy and conviction. The awards exist to give that work an audience and the recognition it deserves.

## Two Categories, One Stage
**Campus Category** — for students and campus filmmakers, recognising the talent emerging from classrooms and college film clubs.

**General Category** — open to independent and professional filmmakers from anywhere in the world.

## Recognising Every Craft
Every film is the work of many hands. Alongside Best Short Film and Best Campus Film, the awards honour direction, screenplay, cinematography, editing, music and performance — so that actors and technicians are celebrated as fully as the films they bring to life.

## Opportunities for Young Creators
For many participants, the festival is a first public screening, a first award, or a first meeting with fellow filmmakers. The awards are built to encourage that first step and the ones that follow.

## The Festival Experience
The festival culminates in a screening and awards ceremony held on 12 February — a date deeply special to Sharankrishna — in association with JAIN (Deemed-to-be University), Kochi.

## The Story Behind Our Logo
The emblem blends three layers into one continuous story. Anti-clockwise spiral lines trace a journey of remembrance, retracing the creative path Sharankrishna once walked. Woven into that movement is the letter **S**, a guiding presence that carries his name. Around it all sits the geometric frame of a camera aperture — the festival's artistic and cinematic focal point.`
            },
            {
                key: "inspiration",
                visible: true,
                kicker: "02 — The Inspiration",
                title: "Remembering Sharankrishna",
                subtitle: "The inspiration behind the name",
                intro: "A visual artist, director and designer whose creativity and warmth left a lasting mark on everyone he met. The awards carry his name so that his spirit keeps finding new stories to tell.",
                image: "IMG_20240317_202624_864.webp",
                imageAlt: "Sharankrishna",
                imageFit: "cover",
                cta: "Read His Story",
                linkLabel: "",
                linkUrl: "",
                body: `## Who He Was
Sharan Krishna was a visual artist, director and designer. A graduate in IT from Jain University, he worked as a designer at Midnay (Kozhikode Cyberpark) and was the co-founder and CEO of Angle Frames.

## A Life in Stories
In a short span of years he directed sixteen short films — among them award-winning works such as *Vidya*, *No*, *Karutham Naalaykkaay*, *Nirbhaya*, *Lisa Bhramam* and *Three Minutes* — along with a web series and a documentary. He also gave his time and design work as a volunteer for WordCamp Kerala.

## The Person Behind the Work
Those who knew him remember his infectious smile, his humility and his selfless love for people — and the quiet "Midas touch" he brought to everything he created.

## Why the Awards Carry His Name
Sharan Krishna passed away on 12 November 2024, at the age of 23. To keep his light alive, his family, friends and teachers instituted the Sharankrishna Short Film Awards. The festival is held on 12 February, a date that was deeply special to him.

> Every story that finds its audience here carries a little of him forward — the kindness, the passion and the boundless creativity he lived by.`
            },
            {
                key: "organizer",
                visible: true,
                kicker: "03 — The Organizer",
                title: "Angle Frames",
                subtitle: "The creative force behind the festival",
                intro: "Founded by Anal Chandran and Sharankrishna, Angle Frames is an independent, multi-disciplinary digital media studio based in Kerala — and the organiser of the Sharankrishna Short Film Awards.",
                image: "Angle frames.webp",
                imageAlt: "Angle Frames",
                imageFit: "cover",
                cta: "Know More About Angle Frames",
                linkLabel: "Watch on YouTube",
                linkUrl: "https://www.youtube.com/@ANGLEFRAMES",
                body: `## Who We Are
Angle Frames is an independent, multi-disciplinary digital media studio based in Kerala, India, focused on high-quality visual production and design. It was founded by Anal Chandran and Sharankrishna on a shared passion for creative storytelling.

## What We Do
- Directing and producing short films
- Social media reels and corporate media videos
- Professional video editing workflows
- Graphic design and promotional publicity artwork

## Our Work
From the mini web series *Ikkachakka* to award-winning independent films, the team takes a raw concept and refines it into a polished, cinematic reality — bringing precise framing, a distinct vision and careful artistry to every piece of work.

## Why We Created the Awards
Angle Frames was co-founded by Sharankrishna. Organising the awards is the studio's way of carrying his work forward — by building a stage for the filmmakers, actors, writers, cinematographers, editors and technicians whose craft the team understands first-hand, and whose work too often goes unrecognised.`
            },
            {
                key: "jain",
                visible: true,
                kicker: "04 — Academic Association",
                title: "JAIN (Deemed-to-be University), Kochi",
                subtitle: "A space for education, innovation and emerging talent",
                intro: "A centre for education, leadership and entrepreneurship, JAIN (Deemed-to-be University), Kochi brings academic communities and creative filmmaking together as the festival's academic partner.",
                image: "Jain 1.webp",
                imageAlt: "JAIN (Deemed-to-be University), Kochi campus",
                imageFit: "cover",
                cta: "Discover JAIN University",
                linkLabel: "Visit the official website",
                linkUrl: "https://www.jainuniversity.ac.in/kochi/",
                body: `## The University
JAIN (Deemed-to-be University) is approved by the University Grants Commission (UGC) and accredited by NAAC with an A++ grade. Its Kochi campus describes itself as "a center for education, leadership, and entrepreneurship for the students of the modern world."

## The Kochi Campus
The campus is located at Knowledge Park, Nirmal Infopark, Kakkanad — within Kochi's technology corridor — and offers an eco-friendly, modern, learner-centric environment.

## Areas of Study
Programmes span Commerce, Management, Humanities & Social Sciences, Sciences, Engineering & Technology and Design.

## Learning Beyond the Classroom
The university emphasises interdisciplinary learning, research, innovation and entrepreneurship, connecting students with industry through internships, professional certifications and hands-on experience — with the aim of developing industry-ready professionals.

## Why JAIN and the Awards
Sharankrishna was himself a graduate of Jain University. The association brings the festival into an academic community, creating a space where students, educators and filmmakers can meet around cinema.

*Institutional details are as published by the university. For current programmes, accreditations and admissions, please visit the official website.*`
            }
        ];

        /****************************************************************
         * ✏️ EASY-EDIT ZONE — Festival Updates & Guidelines
         * Just edit the text below. No HTML knowledge needed.
         * Add, remove, or reorder entries by copying/deleting a block.
         *****************************************************************/

        // Festival Updates — newest entry first.
        const UPDATES_FEED = [
            { date: "Coming Soon", title: "Jury Panel Reveal", text: "Our official jury panel for this edition will be announced here and across our social channels shortly." },
            { date: "Coming Soon", title: "Screening Schedule", text: "The full festival day screening schedule and venue details will be published as the event date approaches." },
            { date: "Now Open", title: "Entries Open", text: "Submissions are now open for the Sharankrishna Short Film Awards. Head to the Registration section to enter your film." }
        ];

        // Festival Guidelines — shown in order, numbered automatically.
        const GUIDELINES_ITEMS = [
            { title: "Screening Conduct", text: "Attendees and finalists are expected to remain seated for the full duration of each screening block. Mobile devices should be silenced inside the auditorium." },
            { title: "Photography & Recording", text: "Personal photography is welcome in lobby and lounge areas. Recording of screened films from inside the auditorium is strictly prohibited to protect filmmakers' copyright." },
            { title: "Accreditation & Entry", text: "A valid e-pass or entry confirmation (sent after registration) must be presented at the venue check-in desk for admission to the festival and awards night." },
            { title: "Code of Conduct", text: "Angle Frames maintains a zero-tolerance policy toward harassment, discrimination, or disruptive behavior of any kind toward fellow attendees, filmmakers, or staff." },
            { title: "Schedule Changes", text: "Screening order and program timings are subject to last-minute adjustment. Please check official festival updates and on-site signage for the most current schedule." }
        ];

        // Replace with confirmed jury members once finalized. Leave src empty to show a placeholder avatar.
        const JURY_PANEL = [
            { name: "To Be Announced", role: "Jury Chair", src: "" },
            { name: "To Be Announced", role: "Filmmaking", src: "" },
            { name: "To Be Announced", role: "Cinematography", src: "" },
            { name: "To Be Announced", role: "Screenwriting", src: "" }
        ];

        let currentWizardStep = 1;
