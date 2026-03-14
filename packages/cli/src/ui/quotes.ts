export type QuoteCategory = 'nolan' | 'action_80s' | 'sci_fi' | 'cult_classics';

export interface Quote {
  text: string;
  category: QuoteCategory;
}

export const QUOTE_LIBRARY: Quote[] = [
  // --- Christopher Nolan (20% target representation) ---
  { text: 'We need to go deeper...', category: 'nolan' },
  { text: 'Building the architecture of the dream...', category: 'nolan' },
  { text: "You mustn't be afraid to dream a little bigger, darling...", category: 'nolan' },
  { text: 'An idea is like a virus...', category: 'nolan' },
  { text: 'I have to believe in a world outside my own mind...', category: 'nolan' },
  { text: 'Memory can change the shape of a room...', category: 'nolan' },
  { text: "Don't believe his lies...", category: 'nolan' },
  { text: "It's not possible. No, it's necessary...", category: 'nolan' },
  { text: 'Do not go gentle into that good night...', category: 'nolan' },
  { text: 'Some men just want to watch the world burn...', category: 'nolan' },
  { text: 'Why do we fall? So we can learn to pick ourselves up...', category: 'nolan' },
  { text: 'Are you watching closely?', category: 'nolan' },
  { text: 'A dream within a dream...', category: 'nolan' },
  {
    text: 'We used to look up at the sky and wonder at our place in the stars...',
    category: 'nolan',
  },
  { text: 'Mankind was born on Earth. It was never meant to die here...', category: 'nolan' },
  { text: 'The night is darkest just before the dawn...', category: 'nolan' },

  // --- 80s Action & Sci-Fi ---
  { text: 'Game over, man! Game over!', category: 'action_80s' },
  {
    text: "I say we take off and nuke the entire site from orbit. It's the only way to be sure...",
    category: 'action_80s',
  },
  { text: 'Get to the chopper!', category: 'action_80s' },
  { text: 'If it bleeds, we can kill it...', category: 'action_80s' },
  { text: "I'll be back...", category: 'action_80s' },
  { text: 'Come with me if you want to live...', category: 'action_80s' },
  { text: 'Let off some steam, Bennett...', category: 'action_80s' },
  { text: 'They drew first blood, not me...', category: 'action_80s' },
  { text: 'If he dies, he dies...', category: 'action_80s' },
  {
    text: "It ain't about how hard you hit. It's about how hard you can get hit and keep moving forward...",
    category: 'action_80s',
  },
  { text: "I'm your worst nightmare...", category: 'action_80s' },
  { text: "Dead or alive, you're coming with me...", category: 'action_80s' },
  { text: 'I have come here to chew bubblegum and kick ass...', category: 'action_80s' },
  { text: 'Yippee-ki-yay, motherfucker...', category: 'action_80s' },
  { text: "I ain't got time to bleed...", category: 'action_80s' },

  // --- Sci-Fi Classics ---
  {
    text: 'Greetings, Starfighter. You have been recruited by the Star League...',
    category: 'sci_fi',
  },
  { text: "I've seen things you people wouldn't believe...", category: 'sci_fi' },
  { text: 'All those moments will be lost in time, like tears in rain...', category: 'sci_fi' },
  { text: 'The spice must flow...', category: 'sci_fi' },
  { text: 'I must not fear. Fear is the mind-killer...', category: 'sci_fi' },
  { text: 'Open the pod bay doors, HAL...', category: 'sci_fi' },
  { text: "I'm sorry, Dave. I'm afraid I can't do that...", category: 'sci_fi' },
  { text: 'Never tell me the odds...', category: 'sci_fi' },
  { text: "I am serious... and don't call me Shirley...", category: 'sci_fi' },
  { text: 'May the Force be with you...', category: 'sci_fi' },

  // --- Cult Classics & High Weirdness ---
  { text: "It's all in the reflexes...", category: 'cult_classics' },
  {
    text: "You know what ol' Jack Burton always says at a time like this?",
    category: 'cult_classics',
  },
  { text: 'Space herpes...', category: 'cult_classics' },
  { text: "Forget it, Jake. It's Chinatown...", category: 'cult_classics' },
  { text: 'The Glaive! You must find the Glaive...', category: 'cult_classics' },
  { text: 'I can see through the eyes of the eagle...', category: 'cult_classics' },
  { text: 'Transylvania 6-5000...', category: 'cult_classics' },
  { text: "It's getting late. The monsters will be out soon...", category: 'cult_classics' },
  { text: 'Klaatu barada nikto...', category: 'cult_classics' },
  { text: 'This is my boomstick!', category: 'cult_classics' },
  { text: 'Hail to the king, baby...', category: 'cult_classics' },
  { text: "Good, bad, I'm the guy with the gun...", category: 'cult_classics' },
  { text: "We're gonna need a bigger boat...", category: 'cult_classics' },
  { text: 'What we have here is a failure to communicate...', category: 'cult_classics' },
];

/**
 * Gets a random quote from the library.
 * Weights the selection so Nolan quotes appear ~20% of the time.
 */
export function getRandomSpinnerQuote(): string {
  const isNolanTime = Math.random() < 0.2; // 20% chance to force a Nolan quote

  let pool = QUOTE_LIBRARY;
  if (isNolanTime) {
    pool = QUOTE_LIBRARY.filter((q) => q.category === 'nolan');
  } else {
    pool = QUOTE_LIBRARY.filter((q) => q.category !== 'nolan');
  }

  // Fallback just in case the arrays are empty
  if (pool.length === 0) pool = QUOTE_LIBRARY;

  const randomIndex = Math.floor(Math.random() * pool.length);
  return pool[randomIndex].text;
}
