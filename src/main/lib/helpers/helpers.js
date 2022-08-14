function Semaphore(max){
    var counter = 0;
    var waiting = [];
    
    var take = function() {
      if (waiting.length > 0 && counter < max){
        counter++;
        let promise = waiting.shift();
        promise.resolve();
      }
    }
    
    this.acquire = function() {
      if(counter < max) {
        counter++
        return new Promise(resolve => {
        resolve();
      });
      } else {
        return new Promise((resolve, err) => {
          waiting.push({resolve: resolve, err: err});
        });
      }
    }
      
    this.release = function() {
     counter--;
     take();
    }

    this.count = function() {
      return counter
    }
    
    this.purge = function() {
      let unresolved = waiting.length;
    
      for (let i = 0; i < unresolved; i++) {
        waiting[i].err('Task has been purged.');
      }
    
      counter = 0;
      waiting = [];
      
      return unresolved;
    }
}

module.exports = {
    Semaphore
}