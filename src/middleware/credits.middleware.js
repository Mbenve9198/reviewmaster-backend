const checkCredits = async (req, res, next) => {
  try {
    const userId = req.userId;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Aggiungi i crediti disponibili alla request per uso successivo
    req.userCredits = user.wallet?.credits || 0;

    // Non blocchiamo la richiesta qui, lasciamo che sia il controller
    // a decidere se ci sono abbastanza crediti per l'operazione specifica
    next();
  } catch (error) {
    console.error('Credits check error:', error);
    res.status(500).json({ message: 'Internal server error checking credits' });
  }
};

module.exports = checkCredits; 