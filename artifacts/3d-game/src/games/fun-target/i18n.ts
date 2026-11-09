/**
 * The status line's texts are the ROULETTE cabinet's (games/roulette/
 * RouletteScreen.tsx `statusLine`), by operator request: one voice across the
 * tables. Two lines take a figure the page appends (`funTargetPrompt` the
 * table minimum, `funTargetMinimum` the same); the rest are verbatim, the loss
 * line included — Bet Ok doubles as Prev Bet here exactly as it does on the
 * wheel.
 */
export const funTargetDict = {
  en: {
    funTargetMute: "Mute sound", funTargetUnmute: "Enable sound", funTargetFullscreen: "Fullscreen", funTargetExitFullscreen: "Exit fullscreen",
    funTargetTitle: "Top 10 Target", funTargetTagline: "Pick your numbers. Follow the wheel.",
    funTargetBack: "Back to lobby", funTargetTake: "Take", funTargetPlace: "Bet Ok", funTargetPrevBet: "Prev Bet",
    funTargetPlacing: "Confirming your bet…", funTargetClear: "Cancel Bet", funTargetSpecific: "Cancel Specific Bet",
    funTargetUndo: "Undo", funTargetRebet: "Re-bet", funTargetExit: "Exit",
    funTargetWelcome: "Welcome To Top 10 Target.", funTargetPrompt: "Please Bet to Start Game . Minimum Bet=",
    funTargetChoice: "You can either make Bet or Press BETOK Button.",
    funTargetClosed: "Bet Time Over.", funTargetAccepted: "Your Bet Has Been Accepted.",
    funTargetSpin: "FOR AMUSEMENT ONLY NO CASH VALUE.", funTargetWin: "Congratulations!!! You Win.",
    funTargetGameOver: "Game over. Press PreBetOK Button or Make Bet.", funTargetLose: "Game over. Press PreBetOK Button or Make Bet.", funTargetTakePrompt: "Please Take the Winning Points.",
    funTargetRemove: "Tap a chip to take it back", funTargetLoading: "Waiting for the next round .",
    funTargetRetrying: "Confirming with the server. Retrying safely…",
    funTargetExpired: "Bet time over — not placed",
    funTargetUncertain: "The round changed. Checking your bet history; no new charge will be sent.",
    funTargetEmpty: "Choose at least one number.", funTargetMinimum: "Minimum bet is ",
    funTargetMaximum: "The table or position limit has been reached.", funTargetFunds: "Score Insufficient.",
    funTargetInvalid: "This slip is not valid.", funTargetDisabled: "This table is currently unavailable.",
    funTargetError: "The request was refused. Please check your slip.", funTargetResult: "Result",
    funTargetMinimumLabel: "Minimum", funTargetMaximumLabel: "Maximum", funTargetReturn: "Total return",
    funTargetLive: "Live bets", funTargetSlips: "Your slips", funTargetHistory: "Recent results",
    funTargetNoBets: "No bets yet", funTargetWaiting: "Waiting for settlement",
    funTargetSettled: "Settled", funTargetRefunded: "Refunded", funTargetRules: "Rules",
    funTargetScore: "Score", funTargetWinner: "Winner", funTargetTotal: "Total bet",
    funTargetBetting: "Place your bets", funTargetSettling: "Settling", funTargetDigit: "Bet on digit",
    funTargetChip: "Select chip", funTargetPaid: "Winnings are credited automatically. Take clears this display.",
    funTargetHistoryError: "History is temporarily unavailable.", funTargetConfigError: "Cannot load table settings.",
    funTargetRefresh: "Try again", funTargetPast: "Previous settled slips", funTargetNoHistory: "Your settled slips will appear here.",
  },
  hi: {
    funTargetGameOver: "दौर समाप्त। दाँव लगाएँ।",
    funTargetMute: "आवाज़ बंद करें", funTargetUnmute: "आवाज़ चालू करें", funTargetFullscreen: "पूरी स्क्रीन", funTargetExitFullscreen: "पूरी स्क्रीन से बाहर",
    funTargetTitle: "टॉप 10 टारगेट", funTargetTagline: "अंक चुनें। पहिये का नतीजा देखें।",
    funTargetBack: "लॉबी में वापस", funTargetTake: "ले लें", funTargetPlace: "दाँव लगाएँ", funTargetPrevBet: "पिछला दाँव",
    funTargetPlacing: "दाँव की पुष्टि हो रही है…", funTargetClear: "दाँव हटाएँ", funTargetSpecific: "खास दाँव हटाएँ",
    funTargetUndo: "वापस", funTargetRebet: "फिर दाँव", funTargetExit: "बाहर",
    funTargetWelcome: "टॉप 10 टारगेट में स्वागत है।", funTargetPrompt: "खेल शुरू करने के लिए दाँव लगाएँ। न्यूनतम दाँव=",
    funTargetChoice: "आप और दाँव लगा सकते हैं या BETOK दबाएँ।",
    funTargetClosed: "दाँव का समय समाप्त।", funTargetAccepted: "आपका दाँव स्वीकार हो गया।",
    funTargetSpin: "पहिया घूम रहा है…", funTargetWin: "बधाई!!! आप जीत गए।",
    funTargetLose: "दौर समाप्त। दाँव लगाएँ।", funTargetTakePrompt: "कृपया जीत के अंक ले लें।",
    funTargetRemove: "चिप वापस लेने के लिए उसे दबाएँ", funTargetLoading: "अगले दौर की प्रतीक्षा।",
    funTargetRetrying: "सर्वर से पुष्टि की जा रही है…",
    funTargetExpired: "दाँव का समय समाप्त — नहीं लगा",
    funTargetUncertain: "दौर बदल गया। इतिहास की जाँच जारी है; नया शुल्क नहीं भेजा जाएगा।",
    funTargetEmpty: "कम से कम एक अंक चुनें।", funTargetMinimum: "न्यूनतम दाँव है ",
    funTargetMaximum: "टेबल या अंक की सीमा पूरी हो गई।", funTargetFunds: "स्कोर अपर्याप्त।",
    funTargetInvalid: "यह दाँव मान्य नहीं है।", funTargetDisabled: "टेबल अभी उपलब्ध नहीं है।",
    funTargetError: "अनुरोध अस्वीकार हुआ। अपना दाँव जाँचें।", funTargetResult: "नतीजा",
    funTargetMinimumLabel: "न्यूनतम", funTargetMaximumLabel: "अधिकतम", funTargetReturn: "कुल वापसी",
    funTargetLive: "लाइव दाँव", funTargetSlips: "आपके दाँव", funTargetHistory: "पिछले नतीजे",
    funTargetNoBets: "अभी कोई दाँव नहीं", funTargetWaiting: "भुगतान की प्रतीक्षा",
    funTargetSettled: "भुगतान हुआ", funTargetRefunded: "दाँव वापस", funTargetRules: "नियम",
    funTargetScore: "स्कोर", funTargetWinner: "जीत", funTargetTotal: "कुल दाँव",
    funTargetBetting: "दाँव लगाएँ", funTargetSettling: "भुगतान जारी", funTargetDigit: "अंक पर दाँव",
    funTargetChip: "चिप चुनें", funTargetPaid: "जीत अपने आप जमा होती है। ले लें दबाने से यह प्रदर्शन हटता है।",
    funTargetHistoryError: "इतिहास अभी उपलब्ध नहीं है।", funTargetConfigError: "टेबल की जानकारी लोड नहीं हुई।",
    funTargetRefresh: "फिर कोशिश करें", funTargetPast: "पिछले निपटाए गए दाँव", funTargetNoHistory: "आपके निपटाए गए दाँव यहाँ दिखाई देंगे।",
  },
} as const;
export type FunTargetKey = keyof typeof funTargetDict.en;

/** The page's own dictionary, kept out of the shared one so nothing existing changes. */
export function ft(lang: string, key: FunTargetKey): string {
  return (lang === "hi" ? funTargetDict.hi : funTargetDict.en)[key];
}
