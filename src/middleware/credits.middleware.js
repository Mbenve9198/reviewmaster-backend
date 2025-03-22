const User = require('../models/user.model');
const creditService = require('../services/creditService');

const checkCredits = async (req, res, next) => {
  try {
    const userId = req.userId;
    
    // Recupera l'ID dell'hotel dalla richiesta (può essere in params, body o query)
    const hotelId = req.params.hotelId || req.body.hotelId || req.query.hotelId;
    
    if (!hotelId) {
      // Se non c'è un hotelId, non possiamo verificare i crediti
      console.log('No hotelId found in request, skipping credit check');
      return next();
    }

    // Utilizza il servizio centralizzato per verificare i crediti
    const creditStatus = await creditService.checkCredits(hotelId);
    
    // Aggiungi le informazioni sui crediti alla richiesta per uso nei controller
    req.creditStatus = creditStatus;

    // Non blocchiamo la richiesta qui, lasciamo che sia il controller
    // a decidere se ci sono abbastanza crediti per l'operazione specifica
    next();
  } catch (error) {
    console.error('Credits check error:', error);
    res.status(500).json({ message: 'Internal server error checking credits' });
  }
};

module.exports = checkCredits; 