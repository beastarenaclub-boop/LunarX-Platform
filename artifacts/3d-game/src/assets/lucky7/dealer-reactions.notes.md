# Dealer reactions

Both generated takes use the opening frame of `dealer-idle-v2.mp4` as their start and end image. They preserve the fictional adult dealer and inherit the idle take's -5.8% vertical alignment. Each source is 1280 x 720, 24 fps, 5.0417 seconds, with native synchronized audio.

- `dealer-greeting.mp4`: raises both hands, joins palms at chest height, smiles and says "Namaste", then returns to the resting pose. Audio transcription confirmed "Namaste". Play once per betting round when at least 5.5 seconds remain.
- `dealer-win.mp4`: smiles, gives three claps, and lowers both hands. Playback starts at 1 second, skipping the leading resting pose so the full action fits inside settlement. Trigger only after the current player's positive settled payout and the current round's dice have landed.

The reaction videos use the same silhouette mask as the idle take. The foreground idle-hand matte is hidden while a reaction is visible, avoiding duplicate hands. Reactions yield to a new reveal, stop when the page is hidden, and never replay after snapshot refreshes. Native video audio follows the game's Sound, master volume and effects volume; blocked audible autoplay retries silently.

Generation prompts and job identifiers are in `dealer-reactions.prompts.json`.
