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

        const CATEGORY_ITEMS = [
            { title: "Best<br>Short Film", emoji: "🎬", image: "" },
            { title: "Best<br>Director", emoji: "👥", image: "" }, 
            { title: "Best<br>Screenplay", emoji: "📝", image: "" }, 
            { title: "Best<br>Actor", emoji: "🧍", image: "" },
            { title: "Best<br>Actress", emoji: "🧍‍♀️", image: "" },
            { title: "Best<br>Cinematography", emoji: "📷", image: "" },
            { title: "Best<br>Editing", emoji: "✂️", image: "" },
            { title: "Best<br>Music", emoji: "🎵", image: "" },
            { title: "Campus<br>Category", emoji: "🎓", image: "" },
            { title: "Special Jury<br>Mentions", emoji: "✨", image: "" }
        ];

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
        const ABOUT_CARDS = [
            {
                eyebrow: "About",
                heading: "Sharankrishna",
                image: "IMG_20240317_202624_864.webp",
                text: `Sharan Krishna was an extraordinarily talented visual artist, director, and designer whose creativity and warmth left an unforgettable mark on everyone he met. A graduate in IT from Jain University and a designer at Midnay (Kozhikode Cyberpark), Sharan was also the Co-founder and CEO of Angle Frames. Tragically, destiny took him away at the young age of 23 on November 12, 2024, but his legacy is monumental—having already directed 16 short films (including award-winners like Vidya, No, Karutham Naalaykkaay, Nirbhaya, Lisa Bhramam, and Three Minutes), a web series, a documentary, and tireless volunteer designs for WordCamp Kerala. Known for his infectious smile, humility, and selfless love for people, Sharan brought a "Midas touch" to everything he created. To keep his inspiring light alive, his family, friends, and teachers have instituted the Sharan Krishna Short Film Award. Hosted on February 12th—a date <strong>deeply special to Sharan</strong>—this award celebrates his timeless spirit and inspires us all to live with the same kindness, passion, and <strong>boundless creativity</strong> that he championed.`
            },
            {
                eyebrow: "About",
                heading: "Jain University",
                image: "Jain 1.webp",
                text: `Established as a prominent regional extension of the highly prestigious parent institution, JAIN (Deemed-to-be University), Kochi stands as a premier hub for <strong>academic excellence, innovation, and global learning</strong> in Kerala. Approved by the University Grants Commission (UGC) and accredited with a distinguished NAAC A++ grade, the university is strategically located at Knowledge Park within the tech-rich Infopark ecosystem in Kakkanad. The eco-friendly, modern campus features a learner-centric environment equipped with fully air-conditioned smart classrooms, advanced computer labs, and a dynamic entrepreneurial ecosystem aligned with National Education Policy (NEP) guidelines. Offering a comprehensive selection of undergraduate and postgraduate <strong>programs</strong> across management, commerce, computer science, and the humanities, JAIN Kochi bridges the gap between theory and industry through hands-on internships, professional certifications, international exchange initiatives, and <strong>robust campus placements</strong>. By cultivating deep critical thinking, real-world skills, and <strong>an entrepreneurial mindset</strong>, the university actively transforms aspiring <strong>students</strong> into globally competent, future-ready professionals and leaders.`
            },
            {
                eyebrow: "About",
                heading: "Angle Frames",
                image: "Angle frames.webp",
                text: `Founded by Anal Chandran and Sharankrishna, ANGLE FRAMES is an independent, multi-disciplinary digital media studio based in Kerala, India, focused on high-quality visual production and design. Built on a passion for creative storytelling, the studio specializes in directing and producing engaging short films, dynamic social media reels, corporate media videos, and professional video editing workflows. Beyond moving images, Angle Frames functions as a full-service creative engine, delivering striking graphic design and promotional publicity artwork to give every project a standout visual identity. From crafting the viral mini-web series Ikkachakka to producing award-winning independent films, the team takes a raw concept and refines it into a polished, cinematic reality—bringing precise framing, unique vision, and distinct artistry to every single piece of content they create.`
            },
            {
                eyebrow: "The Story Behind",
                heading: "Our Logo",
                image: "LOGO.webp",
                text: `The logo for the Sharankrishna Short Film Awards is a deeply symbolic fusion of legacy, identity, and cinematic artistry. At its core, the emblem blends three distinct structural layers to tell a continuous story. The anti-clockwise spiral lines represent a journey of remembrance, intentionally retracing the creative path once walked by Sharan Krishna. Seamlessly woven into this movement is the letter "S", which stands as a guiding presence embodying his name and enduring influence on our craft. Encapsulating it all is the geometric frame of a camera aperture, serving as our absolute artistic and cinematic focal point. Together, these elements reflect Sharan Krishna's life journey through the lens of limitless creativity and vision, anchoring the spirit of this film festival at the very heart of the independent movie industry.`
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
