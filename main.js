(function() {
    'use strict';
    // var API_ROOT = 'http://localhost:3000/api';
    var API_ROOT = '/api';
    var CONT = {
            TYPE_PROJECT: '',
            TYPE_WORKFLOW: 'workflow',
            TYPE_NODE: 'node'
        };

    /******************************
     ** Define moduel.
     ******************************/
    angular.module('kdapWfMonitor', ['ngRoute', 'ngResource', '$strap.directives'])
        .config(['$routeProvider','$locationProvider',
            function($routeProvider, $locationProvider) {
                $locationProvider.hashPrefix('!');
                $routeProvider
                    .when('/:type', {
                        templateUrl: '/view/timeline.html',
                        controller: TimelineCtrl
                    })
                    .when('/:type/:date', {
                        templateUrl: '/view/timeline.html',
                        controller: TimelineCtrl
                    })
                    .otherwise({
                        redirectTo: '/workflow'
                    });

            }
        ])
        .factory('Workflow', ['$resource',
            function($resource) {
                return $resource(API_ROOT + '/workflow');
            }
        ])
        .factory('Node', ['$resource',
            function($resource) {
                return $resource(API_ROOT + '/node');
            }
        ])
        .factory('DetailInfo', ['$resource',
            function($resource) {
                return $resource(API_ROOT + '/:type/detail');
            }
        ])
        .run(['$rootScope', '$location',
            function($rootScope, $location) {
                //For Dev on Mock.
                // var host = $location.host();
                // if( host === 'localhost' ){
                //     $httpBackend.whenGET('/workflow').passThrough();
                //     // $httpBackend.whenGET(/^\/view\//).passThrough();
                //     $httpBackend.whenGET(/^\/view\//).passThrough();
                // }
                $rootScope.$on('$routeChangeStart', function(){
                    hidePopover();
                });
            }
        ]);

    /**
     ** Define Timeline Controller
     **/
    function TimelineCtrl($scope, $rootScope, $routeParams, $location, Workflow, Node, $filter, $compile, DetailInfo, $templateCache, $anchorScroll) {
        var resource, resourceDetail;
        $scope.CONT = CONT;
        function setCurrentType() {
            if ($routeParams.type === CONT.TYPE_WORKFLOW) {
                currentType = CONT.TYPE_WORKFLOW;
            } else if ($routeParams.type === CONT.TYPE_NODE) {
                currentType = CONT.TYPE_NODE;
            }
            return currentType;
        }

        function setResource() {
            if (currentType === CONT.TYPE_WORKFLOW) {
                resource = Workflow;
            } else if (currentType === CONT.TYPE_NODE) {
                resource = Node;
            }
            resourceDetail = DetailInfo;
            return currentType;
        }

        function getDetailInfo(instanceId){
            var params;
            $scope.loadedDetail = false;
            if (currentType === CONT.TYPE_WORKFLOW) {
                params = {
                    type: currentType.toLowerCase(),
                    workflowInstanceId: instanceId
                };
            } else if (currentType === CONT.TYPE_NODE) {
                params = {
                    type: currentType.toLowerCase(),
                    workflowInstanceNodeId: instanceId
                };
            }
            resourceDetail.get(params, function( data ){
                _log('detail data', data);
                $scope.loadedDetail = true;
                if( currentType === CONT.TYPE_NODE){
                    data.node.started = new Date(data.node.started);
                    data.node.ended = new Date(data.node.ended);
                    data.dependencies.forEach(function(d){
                        d.started = new Date(d.started);
                        d.ended = new Date(d.ended);
                    });
                }else{
                    data.workflow.started = new Date(data.workflow.started);
                    data.workflow.ended = new Date(data.workflow.ended);
                    data.subWorkflows.forEach(function(d){
                        d.started = new Date(d.started);
                        d.ended = new Date(d.ended);
                    });
                }
                $scope.detail = data;
                setTimeout(function(){
                    $('.content-panel').scrollTop($('.timeline').height()+$('.header').height() + $('.identity').height()).scrollLeft(0);
                }, 500);

                // $location.hash('buttom');
                // $anchorScroll();
            });
        }
        $scope.getDetailInfo = getDetailInfo;

        $scope.clickForPopover = function( data ){
            var _data = data;
            var content = function(){
                hidePopover();
                if(!angular.isObject(_data.started)){
                    _data.started = _format.parse(_data.started);
                    _data.ended = _format.parse(_data.ended);
                }
                $scope.detailinfo = _data;
                var template = $templateCache.get('info_popover.html');
                var tElement = $compile(template)($scope);
                $scope.$apply();

                return tElement[0].outerHTML;
            };

            var options = {
                trigger: 'click',
                animation: true,
                title: _data.name,
                placement: 'top',
                content: content,
                container: 'body'
            };
            return options;
        };

        function getTimeline() {
            $scope.hasTimeline = false;
            $scope.loaded = false;
            var date = $filter('date')($scope.targetDate, 'yyyyMMdd');
            resource.get({
                date: date
            }, function(data) {
                $scope.hasTimeline = true;
                $scope.loaded = true;
                drawTimeline(data, $scope);
            });
        }
        $scope.getTimeline = getTimeline;

        function search() {
            hidePopover();
            var date = $filter('date')($scope.targetDate, 'yyyy-MM-dd');
            $location.url(currentType + '/' + date);
        }
        $scope.search = search;

        //Initialize
        function init() {
            _compile = $compile;
            $scope.hasTimeline = false;
            $scope.loaded = true;

            $scope.currentType = setCurrentType();
            if (!$scope.currentType) {
                $location.url(CONT.TYPE_WORKFLOW);
            }
            $rootScope.currentType = currentType; //for top menu

            setResource();

            if ($routeParams.date) {
                $scope.targetDate = new Date($routeParams.date);
                getTimeline();
            } else {
                $scope.targetDate = new Date();
                //todo 테스트 코드
                // if (currentType === timelineTypes[0]) {
                //     $scope.targetDate = new Date('2013-11-04');
                // } else {
                //     $scope.targetDate = new Date('2013-09-26');
                // }
            }
        }
        init();
    }

    /********************************
     ** Draw Viz by D3.
     ********************************/
    var _dataset = null;
    var _containerOfTimeline = null;
    var _scale = null;
    var _metaRows = [];

    var _blockWidth = 10;
    var _timeUnitByMinute = 5; //minute
    var _selector = '.timeline';
    var _scope, _compile;
    //2013-11-04 12:17:43 -> https://github.com/mbostock/d3/wiki/Time-Formatting
    var _format = d3.time.format('%Y-%m-%d %H:%M:%S');
    var _popovered;

    function resetAll() {
        // reset value;
        _dataset = null;
        _containerOfTimeline = null;
        _scale = null;
        _metaRows = [];

        // reset svg
        d3.select(_selector + ' svg').remove();
    }

    function drawTimeline(data, $scope) {
        _scope = $scope;
        // $scope.hasTimeline = true;
        var targetDate = $scope.targetDate;

        resetAll();

        //generate data for D3.
        _dataset = initDataSetForTimeline(data);
        _log('_dataset', _dataset);
        _scale = initScale();

        //make SVG Container
        var svg = setSVGContainer(_selector);
        //Drawing
        drawPattern(svg);
        drawBasicBackground(svg, _scale, targetDate);
        drawNodes(svg, _scale);
        drawAxes(svg, _scale);

        //popover
        addListenerForPopover(svg);

        //compile for angular
        _compile(svg[0])(_scope);
    }

    function drawPattern(svg){
        var block = _blockWidth
            , size = {w:4, h:4}
            , basicPattern = {x:0, y:0, width:size.w, height:size.h}
            , successPattern = $.extend({}, basicPattern, {fill:'#4bb1cf'})
            , delayPattern = $.extend({}, basicPattern, {fill:'#ee5f5b'})
            , runningPattern = $.extend({}, basicPattern, {fill:'#5eed5e'})
            , hasDepandPattern = $.extend({}, basicPattern, {x:1, y:1, width:2, height:2, fill:'rgba(255, 255, 255, 0.9)'})
            ;
        function makePattern(defs, patternId, patternData){
            defs.append('pattern')
                .attr({id:patternId, width:size.w, height:size.h, patternUnits:'userSpaceOnUse'})
                .selectAll('rect').data(patternData).enter().append('rect')
                .attr({
                    x:function(d){return d.x;},
                    y:function(d){return d.y;},
                    width:function(d){ return d.width;},
                    height:function(d){ return d.height; },
                    fill:function(d){ return d.fill; }
                });
        }
        var defs = svg.append('defs');
        makePattern(defs, 'successPattern', [successPattern, hasDepandPattern]);
        makePattern(defs, 'delayPattern', [delayPattern, hasDepandPattern]);
        makePattern(defs, 'runningPattern', [runningPattern, hasDepandPattern]);
    }

    function hidePopover() {
        $('.popover.in').each(function () {
            var $this = $(this), popover = $this.data('popover');
            if (popover) {
                $this.popover('hide');
            }
        });
    }

    function addListenerForPopover(svg) {
        //hide popover
        $('.content-panel').on('scroll', function(){
            hidePopover();
        });
        svg.selectAll('.background').on('click', function() {
            hidePopover();
        });
    }

    function drawBasicBackground(svg, scale, targetDate) {
        var size = getContainerSize();
        var yesterday = new Date(targetDate.getTime() - (24 * 60 * 60 * 1000));
        var tomarrow = new Date(targetDate.getTime() + (24 * 60 * 60 * 1000));
        var daysRange = d3.time.day.range(yesterday, tomarrow);
        if (scale.x.domain()[1] < daysRange[1]) {
            daysRange[1] = scale.x.domain()[1];
        }
        var hoursRange = d3.time.hours(scale.x.domain()[0], scale.x.domain()[1]);
        var format = d3.time.format('%I:00 %p');

        var bg = svg.append('g');
        //Background
        bg.append('rect')
            .attr('class', 'background')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', size.width)
            .attr('height', size.height);

        //Today
        bg.append('rect')
            .attr('class', 'today-background')
            .attr('x', scale.x(daysRange[0]))
            .attr('y', 0)
            .attr('width', scale.x(daysRange[1]) - scale.x(daysRange[0]))
            .attr('height', size.height);

        //Line for hours
        var xPointer = function(d) {
            return scale.x(d);
        };

        bg.selectAll('line')
            .data(hoursRange)
            .enter()
            .append('line')
            .attr('x1', xPointer)
            .attr('y1', 0)
            .attr('x2', xPointer)
            .attr('y2', size.height)
            .attr('class', 'hour-grid');

        // Label for hours on the grid.
        var labelGapPixel = 600;
        var countAvariableLabel = Math.floor(size.height / labelGapPixel);
        countAvariableLabel = countAvariableLabel === 0 ? 1 : countAvariableLabel;
        var dataForLabel = [];
        for (var i = 0; i < countAvariableLabel; i++) {
            // dataForLabel.push(hoursRange);
            var len = hoursRange.length;
            for (var j = 0; j < len; j++) {
                dataForLabel.push({
                    idx: i,
                    date: hoursRange[j]
                });
            }
        }

        bg.append('g')
            .attr('class', 'hour-label-group')
            .selectAll('text')
            .data(dataForLabel)
            .enter()
            .append('text')
            .attr('x', function(d) {
                return scale.x(d.date) + 5;
            })
            .attr('y', function(d) {
                return (d.idx + 1) * labelGapPixel;
            })
            .attr('class', 'hour-label-in-grid')
            .text(function(d) {
                return format(d.date);
            });
    }

    function initScale() {
        //domain, range 설정.
        var domain = initDomainSize();
        var range = initRangeSize();
        _log('domain', domain);

        //make Scale
        var xScale = d3.time.scale()
            .domain(domain.x)
            .range(range.x);
        var yScale = d3.scale.linear()
            .domain(domain.y)
            .range(range.y);

        return {
            x: xScale,
            y: yScale
        };
    }

    function drawNodes(svg, scale) {
        svg.append('g')
            .attr('class', 'rects')
            .selectAll('rect')
            .data(_dataset.items)
            .enter()
            .append('rect')
            .attr('id', function(d) {
                return 'unit_' + d.id;
            })
            .attr('x', function(d) {
                return scale.x(new Date(d.started));
            })
            .attr('y', function(d) {
                return scale.y(d.row);
            })
            .attr('width', function(d) {
                var width = scale.x(new Date(d.ended)) - scale.x(new Date(d.started));
                return width >= 0 ? width : 0;
            })
            .attr('height', _blockWidth)
            .attr('class', function(d) {
                var className = d.delayed ? 'delayed' : 'node';
                if (d.state === 'RUNNING') {
                    className = 'running';
                }
                return className;
            })
            // .attr('unique', 'true')     //for popover
            .attr('bs-popover', function(d){
                var filterData = {
                    id: d.id,
                    name: d.name,
                    duration: d.duration,
                    started: d.started,
                    ended: d.ended,
                    state: d.state,
                    dependency: getItemDependency(d),
                    hasWarning: d.hasWarning,
                    delayed : d.delayed
                };
                return 'clickForPopover(' + JSON.stringify(filterData) + ')';
            })
            .attr('fill', function(d){
                var fill;
                if (d.numberOfSubWorkflow > 0 || d.numberOfDependencies > 0 ) {
                    fill = 'url(#successPattern)';
                    fill = d.delayed ? 'url(#delayPattern)' : 'url(#successPattern)' ;
                    if(d.state === 'RUNNING'){
                        fill = 'url(#runningPattern)';
                    }
                } else{
                    fill = d.delayed ? '#ee5f5b' : '#4bb1cf' ;
                    if(d.state === 'RUNNING'){
                        fill = '#5eed5e';
                    }
                }
                   return fill;
            })
        ;
    }
    function getItemDependency(d){
        if( currentType === CONT.TYPE_WORKFLOW ){
            return { label: 'Sub Workflow', count: d.numberOfSubWorkflow};
        }else if(currentType === CONT.TYPE_NODE ){
            return { label: 'Dependency', count: d.numberOfDependencies};
        }

    }

    function getItemId(d){
        if( currentType === CONT.TYPE_WORKFLOW ){
            return d.workflowInstanceId;
        }else if(currentType === CONT.TYPE_NODE ){
            return d.workflowInstanceNodeId;
        }
    }

    function getItemName(d){
        if( currentType === CONT.TYPE_WORKFLOW ){
            return d.workflowName;
        }else if(currentType === CONT.TYPE_NODE ){
            return d.name;
        }
    }

    function drawAxes(svg, scale) {
        var format = d3.time.format('%I:00 %p');

        var xAxis = d3.svg.axis();
        xAxis.scale(scale.x).orient('top')
            .tickFormat(function(d) {
                return format(d);
            }).ticks(15);

        var yAxis = d3.svg.axis();
        yAxis.scale(scale.y).orient('left'); //.ticks(5);

        svg.append('g')
            .attr('class', 'axis xaxis')
            .attr('transform', 'translate(0, -10)')
            .call(xAxis);
        svg.append('g')
            .attr('class', 'axis yaxis')
            .attr('transform', 'translate(-5, 0)')
            .call(yAxis);
    }

    function initDataSetForTimeline(data) {
        var tempSet, dataset = {
            countOfRows: 0,
            items: []
        };

        if (currentType === CONT.TYPE_WORKFLOW) {
            tempSet = data.workflows;
        } else if (currentType === CONT.TYPE_NODE) {
            tempSet = data.nodes;
        }

        prepareData(tempSet);

        _.forEach(tempSet, function(item, index) {
            dataset.items.push({
                started: item.started,
                ended: item.ended,
                row: generateCountOfRow({
                    started: item.started,
                    ended: item.ended,
                    id: item.workflowInstanceId
                }),
                delayed: item.delayed,
                workflowInstanceId: item.workflowInstanceId,
                workflowInstanceNodeId: item.workflowInstanceNodeId,
                id: getItemId(item),
                state: item.state,
                duration: item.duration,
                name: getItemName(item),
                numberOfDependencies: item.numberOfDependencies,
                numberOfSubWorkflow: item.numberOfSubWorkflow,
                hasWarning: item.hasWarning
            });
        });

        return dataset;
    }

    function addDate(dateString, durationTime) {
        var time = _format.parse(dateString).getTime() + durationTime;
        return _format(new Date(time));
    }

    function prepareData(dataset) {
        var timeRange = calculateTimeRangeOfData(dataset);

        var scale = d3.time.scale()
            .domain([timeRange.started, timeRange.ended])
            .range([0, timeRange.duration * getRateForWidth()]); //todo rangeRount()로 바꿔야 할지도 있음. 아니면 0이 아니거나.
        var basicDuration = scale.invert(_blockWidth).getTime() - timeRange.started.getTime(); // unit is ms.

        //ended를 처리하고 너무작 값(?)을 처리한다.
        _.forEach(dataset, function(item) {
            var duration;
            // ended가 null이면 Running임.
            if (!item.ended) {
                item.ended = _format(timeRange.ended); //todo 임시코드!! 현재는 오늘이 아닌 경우만 유효함. 오늘은 현재 시각으로.
            }
            duration = _format.parse(item.ended).getTime() - _format.parse(item.started).getTime();
            if (basicDuration > duration) {
                item.ended = addDate(item.started, basicDuration);
            }
        });
    }

    function generateCountOfRow(duration) {
        var currentRow = 0;

        if (_metaRows.length === 0) {
            _metaRows.push(duration.ended);
            return currentRow;
        }

        currentRow = _.findIndex(_metaRows, function(item) {
            return item < duration.started;
        });

        if (currentRow === -1) {
            _metaRows.push(duration.ended);
            currentRow = _metaRows.length - 1;
        } else {
            _metaRows[currentRow] = duration.ended;
        }

        return currentRow;
    }

    //have to initialize dataset before calling this.
    function setSVGContainer(selector) {
        var size = getContainerSize();
        _containerOfTimeline = d3.select(selector)
            .append('svg')
            .attr('width', size.width)
            .attr('height', size.height)
            .attr('id', 'svgTimeline');
        _log('SVG Container size : ', size);
        return _containerOfTimeline;
    }

    function getCountOfValieRows() {
        return _metaRows.length;
    }

    function initDomainSize() {
        var date = calculateTimeRangeOfData(_dataset.items);
        return {
            x: [date.started, date.ended],
            y: [0, getCountOfValieRows()]
        };
    }

    function calculateTimeRangeOfData(dataset) {
        var minDate = d3.min(dataset, function(d) {
            return d.started;
        });
        var maxDate = d3.max(dataset, function(d) {
            return d.ended;
        });

        minDate = _format.parse(minDate);
        maxDate = _format.parse(maxDate);
        var duration = (maxDate.getTime() - minDate.getTime()) / 1000 / 60; // unit is minute.

        return {
            started: minDate,
            ended: maxDate,
            duration: duration
        };
    }

    function initRangeSize() {
        var rate = getRateForWidth();
        var date = calculateTimeRangeOfData(_dataset.items);
        var rowsCount = getCountOfValieRows();
        var forX = [0, date.duration * rate]; //data의 전체 간격(분) * 기준 픽셀 비율.
        var forY = [0, rowsCount * (_blockWidth + 2)];

        return {
            x: forX,
            y: forY
        };
    }

    function getRateForWidth() {
        return _blockWidth / _timeUnitByMinute; // pixel / minute
    }

    function getVisableRows() {
        var dataset = _dataset;
        var rows = [];
        _.forEach(dataset, function(item, index) {
            if (invalidSide(rows, item.started)) {
                rows.push(item.started);
            }
        });

        return rows;
    }

    function invalidSide(rows, started) {
        return true;
    }

    function getContainerSize() {
        var pixelRange = initRangeSize();

        return {
            width: pixelRange.x[1],
            height: pixelRange.y[1]
        };
    }

    function _log() {
        var args = [];
        _.forEach(arguments, function(item) {
            args.push(item);
        });
        var temp = '%c ' + args.shift() + ' -> ';
        args.unshift('background: #222; color: #bada55');
        args.unshift(temp);
        console.log.apply(console, args);
    }
})();
