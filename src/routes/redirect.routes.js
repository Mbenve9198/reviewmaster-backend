router.get('/review', async (req, res) => {
  const { tid, destination } = req.query;
  
  if (!tid || !destination) {
    return res.status(400).send('Missing parameters');
  }
  
  try {
    // Registra il click
    await ReviewLinkTracking.findOneAndUpdate(
      { trackingId: tid },
      { 
        $set: { clicked: true, clickedAt: new Date() },
        $inc: { clickCount: 1 }
      }
    );
    
    // Reindirizza l'utente alla destinazione
    res.redirect(destination);
  } catch (error) {
    console.error('Error tracking review click:', error);
    res.redirect(destination); // Reindirizza comunque in caso di errore
  }
}); 