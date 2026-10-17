# Teen Patti table soundscape

This replaces the generic ambient synth track on Teen Patti Live only.

- `casino-room.mp3`: edited excerpt of **G16-05-Casino Ambience.wav**, digitized
  by Craig Smith, https://freesound.org/people/craigsmith/sounds/438129/.
  Published there under CC0 1.0. Source preview:
  https://cdn.freesound.org/previews/438/438129_2524442-lq.mp3.
  Poker/craps room voices and physical chips, filtered at 140–5000 Hz,
  excerpted from 4–34 seconds, loudness normalized to -22 LUFS, with short
  fades at the loop boundaries.
- `lounge-jazz.mp3`: 12–108 second excerpt of **Moil** by Ruskerdax,
  https://opengameart.org/content/moil. Published there under CC0 1.0.
  Source: https://opengameart.org/sites/default/files/ruskerdax_-_moil.mp3.
  Rhodes piano, bass, drums and baritone sax. Gain reduced and ends faded.
- `../table/tp-chip-*.mp3` and `tp-card-*.mp3`: Kenney Casino Audio 1.1,
  https://kenney.nl/assets/casino-audio, CC0. License retained in
  `../table/TEEN-PATTI-CC0-LICENSE.txt`.

Casino ambience and jazz have independent toggles. Master mute, tab hiding
and route cleanup stop both HTML audio elements. The bed ducks while the
dealer opens the cards; individual card effects follow the video timestamps.
Original source recordings are kept in the ignored workspace cache.
