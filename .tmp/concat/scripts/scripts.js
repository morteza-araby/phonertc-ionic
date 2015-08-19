"use strict";

 angular.module("config", [])

.constant("ENV", {
  "name": "production",
  "apiEndpoint": "http://api.yoursite.com/"
})

;
'use strict';

angular.module('phonertcdemo', ['ionic', 
                                'ui.router', 
                                'config',
                                'btford.socket-io'])

  .config(["$stateProvider", "$urlRouterProvider", function ($stateProvider, $urlRouterProvider) {
    $stateProvider
      .state('app', {
        url: '/app',
        abstract: true,
        templateUrl: 'templates/app.html'
      })
      .state('app.login', {
        url: '/login',
        controller: 'LoginCtrl',
        templateUrl: 'templates/login.html'
      })
      .state('app.contacts', {
        url: '/contacts',
        controller: 'ContactsCtrl',
        templateUrl: 'templates/contacts.html'
      })
      .state('app.call', {
        url: '/call/:contactName?isCalling',
        controller: 'CallCtrl',
        templateUrl: 'templates/call.html'
      });

    $urlRouterProvider.otherwise('/app/login');
  }])

  .run(["$ionicPlatform", function ($ionicPlatform) {
    $ionicPlatform.ready(function() {
      // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
      // for form inputs)
      if (window.cordova && window.cordova.plugins.Keyboard) {
        cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
      }

      if(window.StatusBar) {
        // org.apache.cordova.statusbar required
        StatusBar.styleDefault();
      }
    });
  }])

  .run(["$state", "signaling", function ($state, signaling) {
    signaling.on('messageReceived', function (name, message) {
      switch (message.type) {
        case 'call':
          if ($state.current.name === 'app.call') { return; }
          
          $state.go('app.call', { isCalling: false, contactName: name });
          break;
      }
    });
  }]);
angular.module('phonertcdemo')
  .factory('signaling', ["socketFactory", function (socketFactory) {
    var socket = io.connect('http://192.168.1.100:3000/');
    
    var socketFactory = socketFactory({
      ioSocket: socket
    });

    return socketFactory;
  }]);
angular.module('phonertcdemo')
  .factory('ContactsService', ["signaling", function (signaling) {
    var onlineUsers = [];

    signaling.on('online', function (name) {
      if (onlineUsers.indexOf(name) === -1) {
        onlineUsers.push(name);
      }
    });

    signaling.on('offline', function (name) {
      var index = onlineUsers.indexOf(name);
      if (index !== -1) {
        onlineUsers.splice(index, 1);
      }
    });

    return {
      onlineUsers: onlineUsers,
      setOnlineUsers: function (users, currentName) {
        this.currentName = currentName;
        
        onlineUsers.length = 0;
        users.forEach(function (user) {
          if (user !== currentName) {
            onlineUsers.push(user);
          }
        });
      }
    }
  }]);
angular.module('phonertcdemo')

  .controller('LoginCtrl', ["$scope", "$state", "$ionicPopup", "signaling", "ContactsService", function ($scope, $state, $ionicPopup, signaling, ContactsService) {
    $scope.data = {};
    $scope.loading = false;

    $scope.login = function () {
      $scope.loading = true;
      signaling.emit('login', $scope.data.name);
    };

    signaling.on('login_error', function (message) {
      $scope.loading = false;
      var alertPopup = $ionicPopup.alert({
        title: 'Error',
        template: message
      });
    });

    signaling.on('login_successful', function (users) {
      ContactsService.setOnlineUsers(users, $scope.data.name);
      $state.go('app.contacts');
    });
  }]);
angular.module('phonertcdemo')

  .controller('ContactsCtrl', ["$scope", "ContactsService", function ($scope, ContactsService) {
    $scope.contacts = ContactsService.onlineUsers;
  }]);
angular.module('phonertcdemo')

  .controller('CallCtrl', ["$scope", "$state", "$rootScope", "$timeout", "$ionicModal", "$stateParams", "signaling", "ContactsService", function ($scope, $state, $rootScope, $timeout, $ionicModal, $stateParams, signaling, ContactsService) {
    var duplicateMessages = [];

    $scope.callInProgress = false;

    $scope.isCalling = $stateParams.isCalling === 'true';
    $scope.contactName = $stateParams.contactName;

    $scope.allContacts = ContactsService.onlineUsers;
    $scope.contacts = {};
    $scope.hideFromContactList = [$scope.contactName];
    $scope.muted = false;

    $ionicModal.fromTemplateUrl('templates/select_contact.html', {
      scope: $scope,
      animation: 'slide-in-up'
    }).then(function(modal) {
      $scope.selectContactModal = modal;
    });

    function call(isInitiator, contactName) {
      console.log(new Date().toString() + ': calling to ' + contactName + ', isInitiator: ' + isInitiator);

      var config = { 
        isInitiator: isInitiator,
        turn: {
          host: 'turn:ec2-54-68-238-149.us-west-2.compute.amazonaws.com:3478',
          username: 'test',
          password: 'test'
        },
        streams: {
          audio: true,
          video: true
        }
      };

      var session = new cordova.plugins.phonertc.Session(config);
      
      session.on('sendMessage', function (data) { 
        signaling.emit('sendMessage', contactName, { 
          type: 'phonertc_handshake',
          data: JSON.stringify(data)
        });
      });

      session.on('answer', function () {
        console.log('Answered!');
      });

      session.on('disconnect', function () {
        if ($scope.contacts[contactName]) {
          delete $scope.contacts[contactName];
        }

        if (Object.keys($scope.contacts).length === 0) {
          signaling.emit('sendMessage', contactName, { type: 'ignore' });
          $state.go('app.contacts');
        }
      });

      session.call();

      $scope.contacts[contactName] = session; 
    }

    if ($scope.isCalling) {
      signaling.emit('sendMessage', $stateParams.contactName, { type: 'call' });
    }

    $scope.ignore = function () {
      var contactNames = Object.keys($scope.contacts);
      if (contactNames.length > 0) { 
        $scope.contacts[contactNames[0]].disconnect();
      } else {
        signaling.emit('sendMessage', $stateParams.contactName, { type: 'ignore' });
        $state.go('app.contacts');
      }
    };

    $scope.end = function () {
      Object.keys($scope.contacts).forEach(function (contact) {
        $scope.contacts[contact].close();
        delete $scope.contacts[contact];
      });
    };

    $scope.answer = function () {
      if ($scope.callInProgress) { return; }

      $scope.callInProgress = true;
      $timeout($scope.updateVideoPosition, 1000);

      call(false, $stateParams.contactName);

      setTimeout(function () {
        console.log('sending answer');
        signaling.emit('sendMessage', $stateParams.contactName, { type: 'answer' });
      }, 1500);
    };

    $scope.updateVideoPosition = function () {
      $rootScope.$broadcast('videoView.updatePosition');
    };

    $scope.openSelectContactModal = function () {
      cordova.plugins.phonertc.hideVideoView();
      $scope.selectContactModal.show();
    };

    $scope.closeSelectContactModal = function () {
      cordova.plugins.phonertc.showVideoView();
      $scope.selectContactModal.hide();      
    };

    $scope.addContact = function (newContact) {
      $scope.hideFromContactList.push(newContact);
      signaling.emit('sendMessage', newContact, { type: 'call' });

      cordova.plugins.phonertc.showVideoView();
      $scope.selectContactModal.hide();
    };

    $scope.hideCurrentUsers = function () {
      return function (item) {
        return $scope.hideFromContactList.indexOf(item) === -1;
      };
    };

    $scope.toggleMute = function () {
      $scope.muted = !$scope.muted;

      Object.keys($scope.contacts).forEach(function (contact) {
        var session = $scope.contacts[contact];
        session.streams.audio = !$scope.muted;
        session.renegotiate();
      });
    };

    function onMessageReceive (name, message) {
      switch (message.type) {
        case 'answer':
          $scope.$apply(function () {
            $scope.callInProgress = true;
            $timeout($scope.updateVideoPosition, 1000);
          });

          var existingContacts = Object.keys($scope.contacts);
          if (existingContacts.length !== 0) {
            signaling.emit('sendMessage', name, {
              type: 'add_to_group',
              contacts: existingContacts,
              isInitiator: false
            });
          }

          call(true, name);
          break;

        case 'ignore':
          var len = Object.keys($scope.contacts).length;
          if (len > 0) { 
            if ($scope.contacts[name]) {
              $scope.contacts[name].close();
              delete $scope.contacts[name];
            }

            var i = $scope.hideFromContactList.indexOf(name);
            if (i > -1) {
              $scope.hideFromContactList.splice(i, 1);
            }

            if (Object.keys($scope.contacts).length === 0) {
              $state.go('app.contacts');
            }
          } else {
            $state.go('app.contacts');
          }

          break;

        case 'phonertc_handshake':
          if (duplicateMessages.indexOf(message.data) === -1) {
            $scope.contacts[name].receiveMessage(JSON.parse(message.data));
            duplicateMessages.push(message.data);
          }
          
          break;

        case 'add_to_group':
          message.contacts.forEach(function (contact) {
            $scope.hideFromContactList.push(contact);
            call(message.isInitiator, contact);

            if (!message.isInitiator) {
              $timeout(function () {
                signaling.emit('sendMessage', contact, { 
                  type: 'add_to_group',
                  contacts: [ContactsService.currentName],
                  isInitiator: true
                });
              }, 1500);
            }
          });

          break;
      } 
    }

    signaling.on('messageReceived', onMessageReceive);

    $scope.$on('$destroy', function() { 
      signaling.removeListener('messageReceived', onMessageReceive);
    });
  }]);
angular.module('phonertcdemo')
  .directive('videoView', ["$rootScope", "$timeout", function ($rootScope, $timeout) {
    return {
      restrict: 'E',
      template: '<div class="video-container"></div>',
      replace: true,
      link: function (scope, element, attrs) {
        function updatePosition() {
          cordova.plugins.phonertc.setVideoView({
            container: element[0],
            local: { 
              position: [240, 240],
              size: [50, 50]
            }
          });
        }

        $timeout(updatePosition, 500);
        $rootScope.$on('videoView.updatePosition', updatePosition);
      }
    }
  }]);