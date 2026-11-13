# Version claude.ai (sur le téléphone, sans installation)

`garde-robe.html` est la version publiée sur claude.ai : https://claude.ai/artifact/1iJnmxPBAjtbw3ZuFv9vBz

- Les données (vêtements, tenues, envies, sélection) sont enregistrées dans la base de l'artifact, visible seulement par le propriétaire. Les photos sont stockées comme assets.
- Le détourage tourne dans le téléphone avec le modèle « silueta » (U²-Net, via rembg) et onnxruntime-web 1.17.3. Ces fichiers sont publiés à côté de la page dans `lib/` (le modèle est découpé en 4 morceaux) mais ne sont pas versionnés ici (≈ 55 Mo).
- Claude pré-remplit la fiche d'un vêtement à partir de la photo, et la recherche « Chercher » passe par la capacité `sample`.
- La collection `suggestions` est remplie par Claude depuis la conversation.
